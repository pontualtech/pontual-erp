-- M-003 — Cria webhook_events_log (idempotência de webhooks por construção)
--
-- Endereça pain point P-017 (anti-pattern T2 — webhooks sem idempotência) e a
-- decisão Q-003 já confirmada: webhook handler usa service_role pra bypass RLS.
-- Tabela inicia vazia, é populada quando código do webhook handler for atualizado
-- em fase posterior pra escrever aqui antes de processar evento.
--
-- Spec: architecture-spec.md §1.5
-- Pré-condição: M-001 aplicada (enums payment_provider, webhook_event_status existem).
-- Risco: BAIXO. Tabela nova, vazia, sem afetar dados existentes.
-- Tempo: ~5s.

BEGIN;

-- Tabela
CREATE TABLE IF NOT EXISTS webhook_events_log (
  id              text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id      text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  provider        payment_provider NOT NULL,
  event_id        text NOT NULL,
  event_type      text NOT NULL,
  status          webhook_event_status NOT NULL DEFAULT 'RECEIVED',
  raw_payload     jsonb NOT NULL,
  signature       text,
  signature_valid boolean,
  related_payment_id text REFERENCES payments(id) ON DELETE SET NULL,
  processing_started_at  timestamptz,
  processing_finished_at timestamptz,
  attempts        smallint NOT NULL DEFAULT 0,
  last_error      text,
  ip_address      inet,
  received_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_provider_event UNIQUE (provider, event_id)
);

-- RLS multi-tenant (T1 anti-pattern: NUNCA esquecer)
ALTER TABLE webhook_events_log ENABLE ROW LEVEL SECURITY;

-- Policy 1: tenant isolation pra queries normais (Next.js seta app.company_id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'webhook_events_log' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON webhook_events_log
      USING (company_id = current_setting('app.company_id', true))
      WITH CHECK (company_id = current_setting('app.company_id', true));
  END IF;
END $$;

-- Policy 2: service_role bypass pro webhook handler (sem JWT na entrada do webhook)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'webhook_events_log' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON webhook_events_log
      TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Índices
CREATE INDEX IF NOT EXISTS idx_webhook_company_received
  ON webhook_events_log (company_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_status
  ON webhook_events_log (status, received_at)
  WHERE status IN ('RECEIVED','FAILED');

CREATE INDEX IF NOT EXISTS idx_webhook_payment
  ON webhook_events_log (related_payment_id);

COMMIT;
