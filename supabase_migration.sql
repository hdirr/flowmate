-- ============================================================
-- FlowMate — Migração completa para multi-tenant
-- Execute no SQL Editor do Supabase (flowmate-code's Project)
-- ============================================================

-- ============================================================
-- 1. EMPRESAS (tenants)
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE,                    -- ex: "empresa-x" para URL futura
  plan        text NOT NULL DEFAULT 'free',   -- free | pro | enterprise
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. PERFIS DE USUÁRIO (liga auth.users → empresa + papel)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  role        text NOT NULL DEFAULT 'seller'  -- admin | manager | seller
                CHECK (role IN ('admin', 'manager', 'seller')),
  is_primary  boolean NOT NULL DEFAULT false, -- admin primário da empresa
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_profiles_company_id_idx ON user_profiles(company_id);

-- ============================================================
-- 3. PERMISSÕES POR PAPEL (configurável por empresa)
-- ============================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('admin', 'manager', 'seller')),
  module      text NOT NULL,   -- pipeline | contacts | chats | automations | import | users | settings
  action      text NOT NULL,   -- view_all | view_own | create | edit | remove | access | execute | send
  enabled     boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, role, module, action)
);

CREATE INDEX IF NOT EXISTS role_permissions_company_role_idx ON role_permissions(company_id, role);

-- ============================================================
-- 4. ADICIONAR company_id + created_by NAS TABELAS EXISTENTES
-- ============================================================

-- crm_stages
ALTER TABLE crm_stages
  ADD COLUMN IF NOT EXISTS company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS crm_stages_company_id_idx ON crm_stages(company_id);

-- crm_contacts
ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fields      jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS crm_contacts_company_id_idx ON crm_contacts(company_id);
CREATE INDEX IF NOT EXISTS crm_contacts_created_by_idx ON crm_contacts(created_by);

-- crm_leads
ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS crm_leads_company_id_idx   ON crm_leads(company_id);
CREATE INDEX IF NOT EXISTS crm_leads_stage_id_idx     ON crm_leads(stage_id);
CREATE INDEX IF NOT EXISTS crm_leads_created_by_idx   ON crm_leads(created_by);

-- flowmate_workflows
ALTER TABLE flowmate_workflows
  ADD COLUMN IF NOT EXISTS company_id      uuid REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trigger_stage_id uuid REFERENCES crm_stages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS flowmate_workflows_company_id_idx ON flowmate_workflows(company_id);

-- flowmate_actions
ALTER TABLE flowmate_actions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;

-- flowmate_executions
ALTER TABLE flowmate_executions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;

-- flowmate_delays
-- (já tem execution_id que liga indiretamente, sem alteração necessária)

-- ============================================================
-- 5. CAMPOS PERSONALIZADOS
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  field_type  text NOT NULL DEFAULT 'text'
                CHECK (field_type IN ('text', 'number', 'date', 'select')),
  options     text[] NOT NULL DEFAULT '{}',  -- para tipo select
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_fields_company_id_idx ON custom_fields(company_id);

-- ============================================================
-- 6. NOTAS DE CONTATO
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  text        text NOT NULL,
  auto        boolean NOT NULL DEFAULT false,  -- criada por automação
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_notes_contact_id_idx ON crm_notes(contact_id);
CREATE INDEX IF NOT EXISTS crm_notes_company_id_idx ON crm_notes(company_id);

-- ============================================================
-- 7. WEBHOOK ENDPOINTS DE ENTRADA (n8n → FlowMate)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  token       text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  entity      text NOT NULL DEFAULT 'contact'
                CHECK (entity IN ('contact', 'lead', 'both')),
  active      boolean NOT NULL DEFAULT true,
  last_hit_at timestamptz,
  hit_count   integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_company_id_idx ON webhook_endpoints(company_id);
CREATE INDEX IF NOT EXISTS webhook_endpoints_token_idx      ON webhook_endpoints(token);

-- Log de chamadas recebidas
CREATE TABLE IF NOT EXISTS webhook_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id    uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payload        jsonb,
  status         text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_logs_endpoint_id_idx ON webhook_logs(endpoint_id);

-- ============================================================
-- 8. ROW LEVEL SECURITY — isolamento por empresa
-- ============================================================

ALTER TABLE companies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_stages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_fields       ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowmate_workflows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowmate_actions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE flowmate_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints   ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs        ENABLE ROW LEVEL SECURITY;

-- Helper: retorna o company_id do usuário logado
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT company_id FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Helper: retorna o role do usuário logado
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- companies: usuário vê só a própria empresa
CREATE POLICY "companies: own company" ON companies
  FOR ALL USING (id = get_my_company_id());

-- user_profiles: usuário vê perfis da própria empresa
CREATE POLICY "user_profiles: same company" ON user_profiles
  FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "user_profiles: admin manages" ON user_profiles
  FOR ALL USING (
    company_id = get_my_company_id()
    AND get_my_role() = 'admin'
  );

-- role_permissions
CREATE POLICY "role_permissions: same company" ON role_permissions
  FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "role_permissions: admin manages" ON role_permissions
  FOR ALL USING (company_id = get_my_company_id() AND get_my_role() = 'admin');

-- crm_stages
CREATE POLICY "crm_stages: same company" ON crm_stages
  FOR ALL USING (company_id = get_my_company_id());

-- crm_contacts: view_all vê tudo, view_own vê só seus
CREATE POLICY "crm_contacts: same company" ON crm_contacts
  FOR ALL USING (company_id = get_my_company_id());

-- crm_leads
CREATE POLICY "crm_leads: same company" ON crm_leads
  FOR ALL USING (company_id = get_my_company_id());

-- crm_notes
CREATE POLICY "crm_notes: same company" ON crm_notes
  FOR ALL USING (company_id = get_my_company_id());

-- custom_fields
CREATE POLICY "custom_fields: same company" ON custom_fields
  FOR ALL USING (company_id = get_my_company_id());

-- flowmate_workflows
CREATE POLICY "workflows: same company" ON flowmate_workflows
  FOR ALL USING (company_id = get_my_company_id());

-- flowmate_actions
CREATE POLICY "actions: same company" ON flowmate_actions
  FOR ALL USING (company_id = get_my_company_id());

-- flowmate_executions
CREATE POLICY "executions: same company" ON flowmate_executions
  FOR ALL USING (company_id = get_my_company_id());

-- webhook_endpoints
CREATE POLICY "webhooks: same company" ON webhook_endpoints
  FOR ALL USING (company_id = get_my_company_id());

-- webhook_logs
CREATE POLICY "webhook_logs: same company" ON webhook_logs
  FOR ALL USING (company_id = get_my_company_id());

-- ============================================================
-- 9. TRIGGER: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER set_updated_at_companies
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_user_profiles
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_crm_contacts
  BEFORE UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_crm_leads
  BEFORE UPDATE ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 10. FUNÇÃO: registrar novo cliente (empresa + admin primário)
-- Chamada no onboarding quando uma empresa se cadastra
-- ============================================================
CREATE OR REPLACE FUNCTION register_company(
  p_company_name text,
  p_user_id      uuid,
  p_user_name    text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  INSERT INTO companies (name)
  VALUES (p_company_name)
  RETURNING id INTO v_company_id;

  INSERT INTO user_profiles (id, company_id, name, role, is_primary)
  VALUES (p_user_id, v_company_id, p_user_name, 'admin', true);

  -- Etapas padrão do pipeline
  INSERT INTO crm_stages (company_id, name, color, position) VALUES
    (v_company_id, 'Entrada',         '#6366f1', 1),
    (v_company_id, 'Contato inicial', '#3b82f6', 2),
    (v_company_id, 'Negociação',      '#f59e0b', 3),
    (v_company_id, 'Decisão',         '#ef4444', 4),
    (v_company_id, 'Fechado',         '#10b981', 5);

  RETURN v_company_id;
END;
$$;

-- ============================================================
-- FIM DA MIGRAÇÃO
-- ============================================================
