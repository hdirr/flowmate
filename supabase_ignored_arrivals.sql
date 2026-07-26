-- ============================================================================
-- FlowMate — tabela de "novos contatos ignorados"
-- ----------------------------------------------------------------------------
-- Guarda os números que o admin marcou como "não é cliente" (amigo / contato
-- pessoal), pra sumirem do card "Novos contatos chegando" e NÃO voltarem.
-- Rode no SQL Editor DEPOIS do supabase_rls.sql (usa get_my_company_id()).
-- Enquanto não rodar, o botão "Ignorar" some o item só na sessão (degrada ok).
-- ============================================================================

begin;

create table if not exists public.ignored_arrivals (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  phone_key   text not null,               -- telefone canônico (últimos 11 dígitos)
  created_at  timestamptz not null default now(),
  unique (company_id, phone_key)
);

alter table public.ignored_arrivals enable row level security;
drop policy if exists tenant_isolation on public.ignored_arrivals;
create policy tenant_isolation on public.ignored_arrivals
  for all to authenticated
  using      (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

create index if not exists idx_ignored_arrivals_company
  on public.ignored_arrivals (company_id, phone_key);

commit;

-- ROLLBACK: drop table public.ignored_arrivals;
