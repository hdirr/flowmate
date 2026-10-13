-- ============================================================================
-- FlowMate — CF-A A2 (contração): remover a chave única GLOBAL de message_id
-- ----------------------------------------------------------------------------
-- Por quê: whatsapp_messages_message_id_idx (único em message_id, sem empresa) faz a
-- SEGUNDA empresa perder a mensagem quando duas empresas veem o mesmo message_id (uma
-- escreve para a outra, ou estão no mesmo grupo). A chave certa — (company_id,
-- message_id), índice whatsapp_messages_company_message_uniq — já existe (PARTE 3 da CF-A).
--
-- PRÉ-REQUISITO: o deploy do commit "fix(CF-A A2): ..." precisa estar no ar ANTES deste
-- SQL (o sync antigo usava onConflict 'message_id' e dependia deste índice).
-- Rode as conferências UMA POR VEZ (o SQL Editor mostra só o último resultado).
-- ============================================================================

-- C1. A chave por empresa existe e é válida (esperado: 1 linha, indisunique = true,
--     indisvalid = true). Se não vier assim, PARE.
select c.relname, i.indisunique, i.indisvalid
  from pg_index i join pg_class c on c.oid = i.indexrelid
 where c.relname = 'whatsapp_messages_company_message_uniq';

-- C2. A chave global ainda existe (esperado: 1 linha). Se não existir, nada a fazer.
select indexname, indexdef from pg_indexes
 where schemaname = 'public' and indexname = 'whatsapp_messages_message_id_idx';

-- C3. Nada repetido dentro da mesma empresa (esperado: 0)
select count(*) as repetidos_na_empresa from (
  select company_id, message_id from public.whatsapp_messages
   where message_id is not null group by 1,2 having count(*) > 1) x;

-- ── Remoção (uma transação; rápida: só apaga o índice) ──
begin;
drop index if exists public.whatsapp_messages_message_id_idx;
-- A busca por message_id continua rápida pela chave por empresa (todas as consultas do
-- código filtram company_id + message_id).
commit;

-- C4. Depois (esperado: 0 linhas para a global; 1 linha para a por empresa)
select indexname from pg_indexes
 where schemaname = 'public'
   and indexname in ('whatsapp_messages_message_id_idx', 'whatsapp_messages_company_message_uniq');

-- ============================================================================
-- ROLLBACK (só se precisar; e SÓ funciona enquanto nenhuma mensagem repetir entre
-- empresas — confira antes com a consulta abaixo, esperado 0):
--   select count(*) from (select message_id from public.whatsapp_messages
--     where message_id is not null group by 1 having count(distinct company_id) > 1) x;
--   create unique index whatsapp_messages_message_id_idx
--     on public.whatsapp_messages (message_id) where message_id is not null;
-- Atenção: depois deste SQL, NÃO reverta o código para antes do commit da A2 sem recriar
-- o índice (o sync antigo usava onConflict 'message_id').
-- ============================================================================
