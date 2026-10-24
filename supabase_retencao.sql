-- FlowMate — retenção e peso dos dados (relatorios/RET-1.md)
-- ----------------------------------------------------------------------------
-- Rode no SQL Editor do Supabase, uma parte por vez. O SQL Editor mostra só o resultado da
-- ÚLTIMA consulta: nas PARTES 0 e 3, selecione e rode UMA consulta por vez.
--
--   PARTE 0  o que mais ocupa espaço + mídia em base64 (SÓ LEITURA)  → me mande o resultado
--   PARTE 1  índices para a limpeza em lotes (opcional, antes de ligar DATA_RETENTION=on)
--   PARTE 2  limpeza do histórico do pg_cron (SÓ depois da PARTE 7 do supabase_cf_a.sql)
--   PARTE 3  conferências DEPOIS (só leitura)
--   ROLLBACK no fim (comentado), por parte.
--
-- Nada aqui apaga dado do FlowMate nem liga comportamento. A limpeza em si é código, atrás de
-- DATA_RETENTION=on na Vercel (desligada). Funciona sem a PARTE 1 (só fica mais lenta quando as
-- tabelas crescerem).
-- ============================================================================


-- ============================================================================
-- PARTE 0 — só leitura. Só tamanhos e contagens, nenhum conteúdo.
-- ============================================================================

-- 0.1 Banco inteiro
select pg_size_pretty(pg_database_size(current_database())) as banco;

-- 0.2 Tabelas que mais ocupam (todos os esquemas do projeto: public, auth, storage, cron, net…)
select n.nspname as esquema, c.relname as tabela,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_relation_size(c.oid))       as dados,
       pg_size_pretty(pg_indexes_size(c.oid))        as indices,
       pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)) as toast,
       c.reltuples::bigint as linhas_estimadas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r','p','m')
   and n.nspname not in ('pg_catalog','information_schema','pg_toast')
 order by pg_total_relation_size(c.oid) desc
 limit 25;

-- 0.3 Índices que mais ocupam
select n.nspname as esquema, t.relname as tabela, i.relname as indice,
       pg_size_pretty(pg_relation_size(i.oid)) as tamanho
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class t on t.oid = x.indrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname not in ('pg_catalog','information_schema','pg_toast')
 order by pg_relation_size(i.oid) desc
 limit 25;

-- 0.4 Mídia em base64 gravada em tabela (esperado: tudo 0). Só contagens.
select
  (select count(*) from public.whatsapp_messages where media_url like 'data:%')               as msgs_media_data_url,
  (select count(*) from public.whatsapp_messages where length(media_url) > 2048)              as msgs_media_url_longa,
  (select count(*) from public.outbound_messages where media->>'url' like 'data:%')           as fila_media_data_url,
  (select count(*) from public.inbound_events
     where payload::text like '%"jpegThumbnail"%')                                             as entrada_com_miniatura;

-- 0.5 O que a limpeza apagaria hoje (contagens)
select
  (select count(*) from public.inbound_events
     where status in ('done','ignored') and received_at < now() - interval '7 days')  as entrada_a_apagar,
  (select count(*) from public.outbound_messages
     where status = 'sent' and created_at < now() - interval '30 days')               as fila_a_apagar,
  (select count(*) from public.ops_alerts
     where resolved_at < now() - interval '90 days')                                  as alertas_a_apagar;


-- ============================================================================
-- PARTE 1 — índices para a limpeza (opcional; rode antes de ligar DATA_RETENTION=on).
-- Hoje as duas tabelas estão quase vazias (as chaves inbound_inbox/send_queue estão
-- desligadas): criar é instantâneo. Com volume, rode em horário de pouco movimento (o
-- create index segura as escritas na tabela até terminar).
-- Índice comum (não parcial) de propósito: a API do Supabase manda o filtro como parâmetro,
-- e o plano genérico não usa índice parcial.
-- ============================================================================
begin;
create index if not exists inbound_events_retention
  on public.inbound_events (status, received_at);
create index if not exists outbound_messages_retention
  on public.outbound_messages (status, created_at);
commit;
-- ops_alerts: sem índice (no máximo um alerta aberto por empresa + tipo + assunto; tabela pequena).


-- ============================================================================
-- PARTE 2 — histórico do pg_cron. SÓ depois da PARTE 7 do supabase_cf_a.sql.
-- O agendador roda a cada minuto e o pg_cron guarda uma linha por execução em
-- cron.job_run_details, para sempre (≈ 1.440 linhas/dia). Esta tarefa apaga as com mais de
-- 7 dias, uma vez por dia (03:17 UTC). Rodar de novo só atualiza o agendamento.
-- ============================================================================
-- select cron.schedule('flowmate-cron-cleanup', '17 3 * * *', $c$
--   delete from cron.job_run_details where end_time < now() - interval '7 days';
-- $c$);
-- Conferir: select jobid, schedule, active from cron.job where jobname = 'flowmate-cron-cleanup';


-- ============================================================================
-- PARTE 3 — conferências DEPOIS (só leitura)
-- ============================================================================
-- 3.1 Índices da PARTE 1 (esperado: 2 linhas)
select indexname from pg_indexes
 where schemaname = 'public'
   and indexname in ('inbound_events_retention','outbound_messages_retention');

-- 3.2 Tarefa da PARTE 2 (esperado: 1 linha, active = true; só se rodou a PARTE 2)
-- select jobid, jobname, schedule, active from cron.job where jobname = 'flowmate-cron-cleanup';


-- ============================================================================
-- ROLLBACK (comentado), por parte
-- ============================================================================
-- PARTE 2: select cron.unschedule('flowmate-cron-cleanup');
-- PARTE 1: drop index if exists public.inbound_events_retention, public.outbound_messages_retention;
-- Código: tirar DATA_RETENTION da Vercel (ou trocar o valor) e fazer redeploy.
