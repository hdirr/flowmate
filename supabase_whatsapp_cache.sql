-- ============================================================================
-- FlowMate — Cache do /api/whatsapp/status (coluna updated_at)
-- Execute no SQL Editor do Supabase (projeto flowmate). IDEMPOTENTE.
--
-- Adiciona updated_at em whatsapp_instances (hoje só existe created_at) e o
-- trigger set_updated_at padrão — o /status lê essa coluna para responder via
-- cache quente sem bater na Evolution a cada abertura da aba Chats.
-- ============================================================================

begin;

alter table public.whatsapp_instances
  add column if not exists updated_at timestamptz not null default now();

-- Backfill: registros já existentes passam a ter updated_at "agora" (cache
-- quente já na primeira consulta). Em operação o trigger mantém o valor.
update public.whatsapp_instances set updated_at = now()
  where updated_at is null or updated_at = '';

-- Trigger padrão de atualização automática (mesmo padrão das outras tabelas).
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at_whatsapp_instances on public.whatsapp_instances;
create trigger set_updated_at_whatsapp_instances
  before update on public.whatsapp_instances
  for each row execute function set_updated_at();

commit;