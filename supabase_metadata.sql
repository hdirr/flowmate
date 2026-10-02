-- ============================================================================
-- FlowMate — coluna `metadata` em contato e lead (P1-E1, API /v1)
-- ----------------------------------------------------------------------------
-- Objeto JSON livre que a integração (n8n etc.) usa para guardar o id do
-- cliente no outro sistema, a origem do lead etc., sem criar campo personalizado.
-- Só a API /v1 lê e grava; a tela não usa.
-- Idempotente (pode rodar de novo). Default constante: no Postgres 11+ o
-- `add column` não reescreve a tabela.
-- Rode no SQL Editor ANTES do deploy que usa a coluna.
-- ============================================================================

begin;

alter table public.crm_contacts add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.crm_leads    add column if not exists metadata jsonb not null default '{}'::jsonb;

commit;

-- Verificação (deve devolver 2 linhas, jsonb, NO, '{}'::jsonb):
-- select table_name, column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and column_name = 'metadata'
--    and table_name in ('crm_contacts', 'crm_leads');

-- ROLLBACK:
-- alter table public.crm_contacts drop column if exists metadata;
-- alter table public.crm_leads    drop column if exists metadata;
