-- Marketing Journeys — nurture perpétuo de leads que recusaram OS (2026-05-22)
--
-- Captura cliente que disse "não" ao orçamento via bot → guarda email/whatsapp
-- → cron diário avalia próximo step do playbook e dispara WA template ou email.
--
-- Idempotente (IF NOT EXISTS) pra suportar re-run sem erro.
--
-- Design:
--   - 1 row por (contact_id, journey_type) — UNIQUE garante.
--   - current_step incrementa a cada envio.
--   - ended_at NULL = ativa; quando preenche, fica histórico imutável.
--   - source_data JSONB livre — { refused_quote_id, bot_session_id,
--     equipments_interest: ['printer','notebook'], original_channel, ... }
--   - outcome enum-soft: 'reactivated' (voltou e criou OS),
--     'unsubscribed' (clicou descadastrar), 'bounced' (email/wa morto),
--     'completed' (terminou ciclo sem reativação — virtualmente perpétuo,
--     mas dá pra encerrar manualmente).

CREATE TABLE IF NOT EXISTS marketing_journeys (
  id              TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  contact_id      TEXT        NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  company_id      TEXT        NOT NULL,
  journey_type    TEXT        NOT NULL DEFAULT 'recused_os',
  current_step    INTEGER     NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_step_at    TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  outcome         TEXT,
  source_data     JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- 1 jornada ativa por contato+tipo (re-captura atualiza, não duplica)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mj_unique_contact_type
  ON marketing_journeys (contact_id, journey_type);

-- Index parcial pro cron: scan rápido só de ativas
CREATE INDEX IF NOT EXISTS idx_mj_active_next
  ON marketing_journeys (started_at, current_step)
  WHERE ended_at IS NULL;

-- Index pra dashboard cohort (groupby mês captura)
CREATE INDEX IF NOT EXISTS idx_mj_started_at_desc
  ON marketing_journeys (started_at DESC);

-- Index pra filtrar por tenant
CREATE INDEX IF NOT EXISTS idx_mj_company_started
  ON marketing_journeys (company_id, started_at DESC);
