-- Marketing contacts: source-of-truth for email marketing campaigns
-- Auto-fed by ERP triggers (OS created/paid/refused), manual entries, web forms, etc.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS marketing_contacts (
  id              text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id      text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email           text NOT NULL,
  name            text,
  phone           text,
  document_number text,
  origin          text NOT NULL DEFAULT 'manual',
  tags            text[] NOT NULL DEFAULT '{}',
  customer_id     text REFERENCES customers(id) ON DELETE SET NULL,
  unsubscribed    boolean NOT NULL DEFAULT false,
  unsubscribed_at timestamptz,
  bounce_count    integer NOT NULL DEFAULT 0,
  last_sent_at    timestamptz,
  last_opened_at  timestamptz,
  last_clicked_at timestamptz,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT marketing_contacts_company_email_unique UNIQUE (company_id, email)
);

CREATE INDEX IF NOT EXISTS idx_mc_email ON marketing_contacts(email);
CREATE INDEX IF NOT EXISTS idx_mc_company_origin ON marketing_contacts(company_id, origin);
CREATE INDEX IF NOT EXISTS idx_mc_tags_gin ON marketing_contacts USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_mc_customer ON marketing_contacts(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mc_unsubscribed ON marketing_contacts(company_id, unsubscribed) WHERE unsubscribed = false;

CREATE OR REPLACE FUNCTION marketing_contacts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mc_set_updated_at ON marketing_contacts;
CREATE TRIGGER trg_mc_set_updated_at
  BEFORE UPDATE ON marketing_contacts
  FOR EACH ROW EXECUTE FUNCTION marketing_contacts_set_updated_at();
