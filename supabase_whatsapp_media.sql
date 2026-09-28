-- ============================================================================
-- FlowMate — Colunas de mídia/remetente em whatsapp_messages
-- Execute no SQL Editor do Supabase (projeto flowmate). IDEMPOTENTE.
--
-- O código (webhook, sync, sendMessage) grava media_url, file_name,
-- participant_jid e sender. A tabela whatsapp_messages foi criada fora das
-- migrações do repo e, em produção, NÃO tinha file_name: todo insert do
-- webhook falhava ("Could not find the 'file_name' column ... schema cache")
-- e as mensagens novas sumiam. Aplicar isto corrige.
-- ============================================================================

alter table public.whatsapp_messages
  add column if not exists media_url text,
  add column if not exists file_name text,
  add column if not exists participant_jid text,
  add column if not exists sender text;

-- Faz o PostgREST enxergar as colunas novas sem esperar o cache expirar.
notify pgrst, 'reload schema';
