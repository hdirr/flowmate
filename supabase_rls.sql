-- ============================================================================
-- ⚠️ INCOMPLETO — NÃO RODAR ISOLADO. Rode DEPOIS o supabase_rls_fix.sql.
--    Este script ADICIONA as políticas corretas, mas o banco tinha políticas
--    ANTIGAS abertas (qual=true) que anulam o isolamento (Postgres soma policies
--    permissivas com OU). O supabase_rls_fix.sql remove essas políticas furadas.
-- ============================================================================
-- FlowMate — Row Level Security (isolamento por empresa / tenant)
-- ----------------------------------------------------------------------------
-- Rode no SQL Editor do Supabase (projeto flowmate). É IDEMPOTENTE (pode rodar
-- mais de uma vez) e REVERSÍVEL (bloco de rollback comentado no fim).
--
-- POR QUE É SEGURO:
--   1. service_role IGNORA RLS. Todas as funções api/* (webhook, /v1, billing,
--      sync, envio) usam service_role -> nada nelas muda.
--   2. O cliente (anon key + JWT) já filtra tudo por company_id no store.js.
--      As políticas abaixo só espelham esse comportamento no banco.
--   3. register_company é SECURITY DEFINER -> onboarding continua funcionando.
--
-- ÚNICA MUDANÇA VISÍVEL: o sino de notificações para de mostrar mensagens de
--   outras empresas (era um vazamento). Isso é a correção, não uma quebra.
--
-- Recomendado rodar em horário de baixo movimento. Rollback leva segundos.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. HELPERS  (SECURITY DEFINER = o fix central: mata a recursão infinita que
--    derrubava a política de user_profiles e travava o login)
-- ----------------------------------------------------------------------------
create or replace function public.get_my_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id from public.user_profiles where id = auth.uid() limit 1;
$$;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.user_profiles where id = auth.uid() limit 1;
$$;

grant execute on function public.get_my_company_id() to authenticated;
grant execute on function public.get_my_role()       to authenticated;

-- ----------------------------------------------------------------------------
-- 2. TABELAS-PADRÃO DO TENANT  (têm coluna company_id; cliente lê E escreve)
--    Política única FOR ALL: só enxerga/grava linhas da própria empresa.
--    WITH CHECK garante que inserts/updates não "escapem" pra outra empresa.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'role_permissions',
    'crm_pipelines',
    'crm_stages',
    'crm_contacts',
    'crm_leads',
    'crm_notes',
    'custom_fields',
    'flowmate_workflows',
    'company_integrations'   -- guarda api_key / webhook_secret: isolamento crítico
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists tenant_isolation on public.%I', t);
      execute format(
        'create policy tenant_isolation on public.%I '
        'for all to authenticated '
        'using (company_id = public.get_my_company_id()) '
        'with check (company_id = public.get_my_company_id())', t);
    else
      raise notice 'tabela % nao existe, pulando', t;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. companies  (a chave do tenant é a PK "id", não "company_id")
-- ----------------------------------------------------------------------------
alter table public.companies enable row level security;
drop policy if exists tenant_isolation on public.companies;
create policy tenant_isolation on public.companies
  for all to authenticated
  using      (id = public.get_my_company_id())
  with check (id = public.get_my_company_id());

-- ----------------------------------------------------------------------------
-- 4. user_profiles  (id = auth.uid(); precisa de política própria)
--    - qualquer usuário lê os perfis da própria empresa (login, tela de equipe)
--    - só admin cria/edita/remove usuários (bate com o gating da UI)
--    Sem recursão porque os helpers são SECURITY DEFINER.
-- ----------------------------------------------------------------------------
alter table public.user_profiles enable row level security;
drop policy if exists up_select on public.user_profiles;
drop policy if exists up_admin  on public.user_profiles;

create policy up_select on public.user_profiles
  for select to authenticated
  using (company_id = public.get_my_company_id());

create policy up_admin on public.user_profiles
  for all to authenticated
  using      (company_id = public.get_my_company_id() and public.get_my_role() = 'admin')
  with check (company_id = public.get_my_company_id() and public.get_my_role() = 'admin');

-- ----------------------------------------------------------------------------
-- 5. whatsapp_messages  (cliente só LÊ; inserts são todos via service_role)
--    Fecha o vazamento do sino de notificações.
-- ----------------------------------------------------------------------------
alter table public.whatsapp_messages enable row level security;
drop policy if exists tenant_read on public.whatsapp_messages;
create policy tenant_read on public.whatsapp_messages
  for select to authenticated
  using (company_id = public.get_my_company_id());

-- ----------------------------------------------------------------------------
-- 6. TABELAS SÓ-SERVIDOR  (cliente nunca toca; só service_role, que ignora RLS)
--    Liga RLS SEM política => authenticated fica trancado, service_role passa.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'whatsapp_instances',
    'conversations',
    'pending_signups'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security', t);
    else
      raise notice 'tabela % nao existe, pulando', t;
    end if;
  end loop;
end $$;

commit;

-- ============================================================================
-- NOTA sobre o Storage (bucket whatsapp-media):
--   O bucket é PÚBLICO de propósito — a Evolution/WhatsApp precisa baixar a
--   mídia pela URL pública. Não mexer nele aqui. Se um dia quiser privar,
--   é outra migração (storage.objects), com URLs assinadas no código.
-- ============================================================================

-- ============================================================================
-- VERIFICAÇÃO (rode logado como um usuário de teste, NÃO como service_role):
--   -- deve retornar só os contatos da SUA empresa:
--   -- select count(*) from crm_contacts;
--   -- confere quais tabelas estão com RLS ligado:
--   -- select relname, relrowsecurity from pg_class
--   --   where relnamespace = 'public'::regnamespace and relrowsecurity;
-- ============================================================================

-- ============================================================================
-- ROLLBACK (se algo sair diferente do esperado — reverte em segundos):
--   alter table public.companies           disable row level security;
--   alter table public.user_profiles        disable row level security;
--   alter table public.role_permissions     disable row level security;
--   alter table public.crm_pipelines        disable row level security;
--   alter table public.crm_stages           disable row level security;
--   alter table public.crm_contacts         disable row level security;
--   alter table public.crm_leads            disable row level security;
--   alter table public.crm_notes            disable row level security;
--   alter table public.custom_fields        disable row level security;
--   alter table public.flowmate_workflows   disable row level security;
--   alter table public.company_integrations disable row level security;
--   alter table public.whatsapp_messages    disable row level security;
--   alter table public.whatsapp_instances   disable row level security;
--   alter table public.conversations        disable row level security;
--   alter table public.pending_signups      disable row level security;
-- ============================================================================
