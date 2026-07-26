-- ============================================================================
-- FlowMate — Índices por company_id / hot paths
-- ----------------------------------------------------------------------------
-- Rode no SQL Editor do Supabase DEPOIS do supabase_rls.sql.
-- IDEMPOTENTE (create index if not exists) e SEGURO.
--
-- POR QUÊ: com RLS ligado, TODA query do cliente ganha um filtro implícito por
-- company_id. Sem índice, o banco varre a tabela inteira e filtra depois — ok
-- com pouca linha, lento conforme escala. Estes índices casam com as queries
-- reais do código (store.js / api/*).
--
-- As tabelas estão pequenas agora, então CREATE INDEX comum roda em ms e trava
-- por um instante. Quando as tabelas ficarem grandes (dezenas de milhares de
-- linhas), troque por CREATE INDEX CONCURRENTLY (sem lock; NÃO pode rodar dentro
-- de transação/BEGIN e cria um índice por vez).
-- ============================================================================

-- ── whatsapp_messages (tabela que mais cresce) ──────────────────────────────
-- NotificationBell: company_id (via RLS) + order by timestamp desc
create index if not exists idx_wa_msg_company_ts
  on public.whatsapp_messages (company_id, "timestamp" desc);
-- Chats: carrega por instância, ordenado por timestamp
create index if not exists idx_wa_msg_instance_ts
  on public.whatsapp_messages (instance_name, "timestamp");
-- Deduplicação no webhook/conversations: lookup por message_id (por mensagem que entra)
create index if not exists idx_wa_msg_message_id
  on public.whatsapp_messages (message_id)
  where message_id is not null;

-- ── conversations (lookup por mensagem que entra — hot path do webhook) ──────
create index if not exists idx_conversations_company_jid
  on public.conversations (company_id, remote_jid);

-- ── crm_contacts ────────────────────────────────────────────────────────────
create index if not exists idx_contacts_company_created
  on public.crm_contacts (company_id, created_at desc);

-- ── crm_leads ───────────────────────────────────────────────────────────────
create index if not exists idx_leads_company_created
  on public.crm_leads (company_id, created_at desc);
create index if not exists idx_leads_company_pipeline
  on public.crm_leads (company_id, pipeline_id);
create index if not exists idx_leads_contact
  on public.crm_leads (contact_id);

-- ── crm_stages ──────────────────────────────────────────────────────────────
create index if not exists idx_stages_company_pipeline_pos
  on public.crm_stages (company_id, pipeline_id, position);

-- ── crm_notes (listadas por contato, dentro da empresa) ─────────────────────
create index if not exists idx_notes_company_contact_created
  on public.crm_notes (company_id, contact_id, created_at);

-- ── crm_pipelines ───────────────────────────────────────────────────────────
create index if not exists idx_pipelines_company_pos
  on public.crm_pipelines (company_id, position);

-- ── custom_fields ───────────────────────────────────────────────────────────
create index if not exists idx_custom_fields_company_created
  on public.custom_fields (company_id, created_at);

-- ── flowmate_workflows (runAutomations filtra company + trigger_type + enabled)
create index if not exists idx_workflows_company_trigger
  on public.flowmate_workflows (company_id, trigger_type);

-- ── role_permissions (carregado no login, por company + role) ───────────────
create index if not exists idx_role_perms_company_role
  on public.role_permissions (company_id, role);

-- ── user_profiles (tela de equipe lista por company; get_my_company_id usa PK)
create index if not exists idx_user_profiles_company
  on public.user_profiles (company_id);

-- ============================================================================
-- NOTA: company_integrations e whatsapp_instances já têm índice único em
--   company_id (vem do onConflict='company_id' dos upserts) — não precisam aqui.
--
-- VERIFICAÇÃO (opcional): ver os índices criados
--   select indexname, tablename from pg_indexes
--     where schemaname = 'public' and indexname like 'idx_%' order by tablename;
-- ============================================================================
