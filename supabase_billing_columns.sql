-- ============================================================================
-- FlowMate — Colunas de assinatura/plano (billing)
-- ----------------------------------------------------------------------------
-- Execute no SQL Editor do Supabase. IDEMPOTENTE (pode rodar mais de uma vez).
--
-- MOTIVO: o código (auth.js, billing/*, Onboarding) lê/escreve plan_level,
-- plan_tier, plan_cycle, subscription_status, line_cap e current_period_end em
-- companies (e pending_signups), mas nenhuma migração anterior criou essas
-- colunas — resultando em 400 do PostgREST ("Could not find the 'X' column").
--
-- NOTA DE PRODUTO: subscription_status fica NULL para linhas existentes (frente
-- ao auth.subscriptionActive que é fail-open) — ninguém é trancado por engano.
-- ============================================================================

begin;

alter table public.companies
  add column if not exists plan_level          text,
  add column if not exists plan_tier           text default 't1',
  add column if not exists plan_cycle          text default 'mensal',
  add column if not exists subscription_status text,
  add column if not exists line_cap            integer default 0,
  add column if not exists current_period_end  timestamptz;

-- pending_signups pode não existir em bancos mais antigos — só altera se existir.
do $$
begin
  if exists (select 1 from pg_class where relname = 'pending_signups' and relnamespace = 'public'::regnamespace) then
    alter table public.pending_signups
      add column if not exists plan_level          text,
      add column if not exists plan_tier           text,
      add column if not exists plan_cycle          text,
      add column if not exists subscription_status text;
  end if;
end $$;

commit;

-- ============================================================================
-- ROLLBACK (se precisar reverter — apenas as colunas novas):
--   alter table public.companies
--     drop column if exists current_period_end,
--     drop column if exists line_cap,
--     drop column if exists subscription_status,
--     drop column if exists plan_cycle,
--     drop column if exists plan_tier,
--     drop column if exists plan_level;
-- ============================================================================