-- Marketing webhook events log — armazena eventos crus do Resend (e futuros providers).
-- Dedup por UNIQUE(provider, event_id) protege contra retries de webhook.
-- Tabela isolada (não acopla a Payment.WebhookEventLog) pra evitar mudar enum payment_provider.
-- Idempotente: safe to re-run.

CREATE TABLE IF NOT EXISTS marketing_webhook_event (
  id               text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id       text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider         text NOT NULL DEFAULT 'resend',
  event_id         text NOT NULL,
  event_type       text NOT NULL,
  email            text NOT NULL,
  contact_id       text REFERENCES marketing_contacts(id) ON DELETE SET NULL,
  raw_payload      jsonb NOT NULL,
  signature        text,
  signature_valid  boolean,
  status           text NOT NULL DEFAULT 'RECEIVED',
  last_error       text,
  ip_address       inet,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  CONSTRAINT marketing_webhook_event_provider_eventid_uniq UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_mwe_email
  ON marketing_webhook_event(email);

CREATE INDEX IF NOT EXISTS idx_mwe_contact
  ON marketing_webhook_event(contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mwe_company_received
  ON marketing_webhook_event(company_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_mwe_event_type
  ON marketing_webhook_event(event_type);

CREATE INDEX IF NOT EXISTS idx_mwe_status_received
  ON marketing_webhook_event(status, received_at DESC)
  WHERE status IN ('RECEIVED', 'FAILED');
