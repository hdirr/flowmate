-- ============================================================================
-- FlowMate — Grupos de WhatsApp
-- Execute no SQL Editor do Supabase (projeto flowmate). IDEMPOTENTE (pode rodar
-- mais de uma vez).
--
-- Cria:
--   1. whatsapp_groups   — grupos conhecidos do número da empresa
--      (company_id, instance_name → pronto para multi-linha)
--   2. participant_jid   — remetente dentro do grupo, no log de mensagens
--   3. RLS: cliente LÊ whatsapp_groups (inbox); escrita só service_role.
-- ============================================================================

begin;

create table if not exists public.whatsapp_groups (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  instance_name      text not null,                              -- flowmate-{company_id}
  jid                text not null,                              -- 120363...@g.us
  name               text not null,
  description        text,
  participant_phones jsonb not null default '[]',                -- snapshot p/ a UI
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, jid)
);

create index if not exists whatsapp_groups_company_jid_idx
  on public.whatsapp_groups (company_id, jid);
create index if not exists whatsapp_groups_instance_name_idx
  on public.whatsapp_groups (instance_name);

-- Remetente dentro de um grupo (no log de mensagens). Nulo em conversas 1:1.
alter table public.whatsapp_messages
  add column if not exists participant_jid text;

-- RLS: cliente só LÊ os grupos da própria empresa; inserts/updates são via
-- service_role (api/*), que ignora RLS. Mesmo padrão do whatsapp_messages.
alter table public.whatsapp_groups enable row level security;
drop policy if exists tenant_read on public.whatsapp_groups;
create policy tenant_read on public.whatsapp_groups
  for select to authenticated
  using (company_id = public.get_my_company_id());

commit;

-- ============================================================================
-- ROLLBACK (se algo sair diferente do esperado — reverte em segundos):
--   alter table public.whatsapp_groups   disable row level security;
--   drop table public.whatsapp_groups;
--   alter table public.whatsapp_messages drop column participant_jid;
-- ============================================================================