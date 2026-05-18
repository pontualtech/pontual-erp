-- ============================================================================
-- 20260518_marketing_stage_automations
--
-- CRM Marketing — Bloco 1: Automações ao mudar de fase no Kanban.
-- Permite configurar regras "quando contato move de A para B, dispare X".
--
-- DESIGN:
-- - from_stage NULL = qualquer origem; to_stage NULL = qualquer destino
-- - action_type controla o que executa (email/whatsapp/webhook/task)
-- - payload jsonb pra flexibilidade por action_type
-- - delay_minutes pra drip sequences futuras (MVP usa 0 = imediato)
-- - runs guarda log de cada execução pra auditoria
-- - ON DELETE CASCADE em automation_id (deletar regra apaga histórico junto)
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketing_stage_automations (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  from_stage text,
  to_stage text,
  action_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  delay_minutes integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_stage_automations_action_chk
    CHECK (action_type IN ('email', 'whatsapp', 'webhook', 'task')),
  CONSTRAINT marketing_stage_automations_stage_not_both_null
    CHECK (from_stage IS NOT NULL OR to_stage IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_marketing_stage_automations_company
  ON marketing_stage_automations (company_id);

CREATE INDEX IF NOT EXISTS idx_marketing_stage_automations_match
  ON marketing_stage_automations (company_id, active, from_stage, to_stage);

-- ----------------------------------------------------------------------------
-- runs: log de execuções
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketing_automation_runs (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  automation_id text NOT NULL REFERENCES marketing_stage_automations(id) ON DELETE CASCADE,
  contact_id text,
  from_stage text,
  to_stage text,
  status text NOT NULL,
  error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT marketing_automation_runs_status_chk
    CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_marketing_automation_runs_company_created
  ON marketing_automation_runs (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_automation_runs_automation
  ON marketing_automation_runs (automation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_automation_runs_contact
  ON marketing_automation_runs (contact_id, created_at DESC);
