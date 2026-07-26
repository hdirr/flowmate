-- ============================================================================
-- FlowMate — CORREÇÃO CRÍTICA de RLS (remove políticas furadas + endurece)
-- ----------------------------------------------------------------------------
-- CONTEXTO: o supabase_rls.sql ADICIONOU políticas corretas, mas NÃO removeu
-- políticas antigas abertas (qual = true) que já existiam no banco. No Postgres
-- políticas permissivas se somam com OU -> uma política `true` anula todas as
-- outras. Efeito: crm_contacts / crm_leads / crm_stages e as tabelas flowmate_*
-- ficaram legíveis/graváveis por QUALQUER um com a anon key (que é pública).
--
-- Este script:
--   A. REMOVE as políticas abertas (o vazamento cross-tenant — urgente).
--   B. REMOVE políticas duplicadas/redundantes (deixa uma regra clara por tabela).
--   C. ENDURECE 3 brechas INTERNAS (dentro da mesma empresa) que sobraram de
--      políticas antigas: auto-escalada de papel, escrita indevida em log de
--      mensagens e em permissões.
--
-- Verificado no código (src/): o frontend NÃO usa flowmate_actions/delays/
-- executions nem webhook_endpoints/logs (legado); só LÊ whatsapp_messages; e a
-- única escrita em user_profiles é toggleActive (ação de admin).
--
-- IDEMPOTENTE (drop ... if exists) e transacional. Rode no SQL Editor.
-- Backend (service_role) NÃO é afetado. Lead público passa pela API, também ok.
-- ============================================================================

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- A. VAZAMENTO CROSS-TENANT — remover TODA política aberta (qual = true)
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "public read contacts"    on public.crm_contacts;
drop policy if exists "public read leads"        on public.crm_leads;
drop policy if exists "public read stages"       on public.crm_stages;
drop policy if exists "Enable all for anon users" on public.flowmate_actions;
drop policy if exists "Enable all for anon users" on public.flowmate_delays;
drop policy if exists "Enable all for anon users" on public.flowmate_executions;
drop policy if exists "Enable all for anon users" on public.flowmate_workflows;

-- ─────────────────────────────────────────────────────────────────────────
-- B. DUPLICATAS — manter uma única política por tabela (a tenant_isolation).
--    Removo as versões antigas "*: same company" que fazem a mesma coisa.
-- ─────────────────────────────────────────────────────────────────────────
drop policy if exists "companies: own company"     on public.companies;
drop policy if exists "crm_contacts: same company" on public.crm_contacts;
drop policy if exists "crm_leads: same company"    on public.crm_leads;
drop policy if exists "crm_stages: same company"   on public.crm_stages;
drop policy if exists "crm_notes: same company"    on public.crm_notes;
drop policy if exists "custom_fields: same company" on public.custom_fields;
drop policy if exists "workflows: same company"    on public.flowmate_workflows;
-- whatsapp_instances: duplicata de SELECT (mantém a "company_own" que é ALL)
drop policy if exists "users read own company instance" on public.whatsapp_instances;

-- ─────────────────────────────────────────────────────────────────────────
-- C. BRECHAS INTERNAS (mesma empresa) — endurecimento
-- ─────────────────────────────────────────────────────────────────────────

-- C1. user_profiles: as políticas *_own permitiam o usuário dar UPDATE na
--     própria linha => qualquer um podia se auto-promover a role='admin'.
--     O cliente não faz self-update (toggleActive é ação de admin, coberta por
--     up_admin). Removo as *_own; ficam up_select (ler da empresa) + up_admin.
drop policy if exists "select_own" on public.user_profiles;
drop policy if exists "update_own" on public.user_profiles;
drop policy if exists "insert_own" on public.user_profiles;
drop policy if exists "delete_own" on public.user_profiles;

-- C2. whatsapp_messages: a política "company_own" (ALL) deixava um usuário
--     apagar/forjar o log de mensagens via anon key. O cliente só LÊ.
--     Mantenho apenas leitura (tenant_read). Inserts continuam via service_role.
drop policy if exists "company_own"                     on public.whatsapp_messages;
drop policy if exists "users read own company messages" on public.whatsapp_messages;

-- C3. role_permissions: a tenant_isolation (ALL por empresa) deixava QUALQUER
--     membro escrever permissões (um vendedor podia se dar acesso). As políticas
--     antigas são mais corretas: todos LEEM (login), só admin ESCREVE.
drop policy if exists "tenant_isolation" on public.role_permissions;
-- (permanecem: "role_permissions: same company" [SELECT] e
--              "role_permissions: admin manages" [ALL admin])

commit;

-- ============================================================================
-- VERIFICAÇÃO 1 — não pode sobrar NENHUMA política aberta (deve vir VAZIO):
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public' and (qual = 'true' or with_check = 'true')
--   order by tablename;
--
-- VERIFICAÇÃO 2 — todas as tabelas de tenant com RLS ligado (relrowsecurity=t):
--   select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace and relrowsecurity order by relname;
--
-- VERIFICAÇÃO 3 — política final por tabela (revisão humana):
--   select tablename, policyname, cmd, qual
--   from pg_policies where schemaname='public' order by tablename, policyname;
--
-- TESTE NO APP (logado como usuário real): Contatos, Pipeline, Chats,
--   Automações (criar/executar), tela de Equipe (admin). Tudo deve funcionar.
--   Se algo vier vazio/quebrar, era dependência de um furo — me diga qual.
-- ============================================================================

-- ============================================================================
-- ESTADO FINAL ESPERADO (uma regra clara por tabela):
--   companies, company_integrations, crm_pipelines, crm_stages, crm_contacts,
--   crm_leads, crm_notes, custom_fields, flowmate_workflows
--       -> tenant_isolation (ALL, company_id/id = get_my_company_id())
--   flowmate_actions, flowmate_executions, webhook_endpoints, webhook_logs
--       -> "*: same company" (ALL, company_id) [legado; cliente não usa]
--   flowmate_delays
--       -> SEM política de cliente (RLS on + sem policy = negado ao cliente;
--          não tem company_id e o frontend não a usa; service_role acessa)
--   role_permissions
--       -> SELECT: mesma empresa | WRITE: só admin
--   user_profiles
--       -> SELECT: perfis da empresa | WRITE: só admin (up_admin)
--   whatsapp_messages
--       -> SELECT: mesma empresa (somente leitura p/ cliente)
--   whatsapp_instances
--       -> company_own (ALL, mesma empresa)
--   conversations, pending_signups
--       -> SEM política (só service_role via API) — correto e seguro
-- ============================================================================
