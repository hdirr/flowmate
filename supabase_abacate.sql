-- ============================================================================
-- FlowMate — colunas do AbacatePay (migração de provedor de pagamento)
-- ----------------------------------------------------------------------------
-- Rode no SQL Editor. Guarda os IDs do AbacatePay em companies e pending_signups.
-- As colunas asaas_* ficam (inofensivas) até a migração ser 100% validada.
-- ============================================================================

alter table public.companies       add column if not exists abacate_customer_id text;
alter table public.companies       add column if not exists abacate_billing_id  text;
alter table public.pending_signups add column if not exists abacate_customer_id text;
alter table public.pending_signups add column if not exists abacate_billing_id  text;

-- Lookup do webhook (billing.paid) por billing id
create index if not exists idx_pending_abacate_billing on public.pending_signups (abacate_billing_id);
create index if not exists idx_companies_abacate_billing on public.companies (abacate_billing_id);
