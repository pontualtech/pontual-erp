-- M-004 — Cria payment_history (audit log) + trigger automática em payments.
--
-- Endereça pain point P-021 (audit trail estruturado).
--
-- DIVERGÊNCIA INTENCIONAL DA SPEC: spec original (architecture-spec §1.3 + §1.4
-- migration-plan M-004) declara old_status/new_status como `payment_status` enum.
-- Como `payments.status` ainda é TEXT em produção (conversão pra enum só em
-- M-006), cast TEXT→ENUM no trigger pode falhar pra valores não-canônicos.
-- Pragmaticamente: declaramos como TEXT aqui, podemos migrar pra ENUM em M-006
-- junto com payments.status conversão.
--
-- DEFESA EXTRA: trigger usa EXCEPTION WHEN OTHERS pra que falha de audit log
-- NÃO QUEBRE operações em payments (princípio: auditoria nunca deve quebrar
-- a coisa que está sendo auditada).
--
-- Pré-condições: M-002 aplicada (payments com colunas v2). M-003 aplicada
-- (webhook_events_log existe pra FK opcional).
-- Risco: BAIXO. Trigger ataca CADA INSERT/UPDATE/DELETE em payments, mas com
-- exception handler. payment_history é tabela nova vazia. Rollback simples
-- (DROP TRIGGER + DROP TABLE).
-- Tempo: ~10s.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela payment_history
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_history (
  id            text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id    text NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  payment_id    text NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN
                  ('CREATED','UPDATED','STATUS_CHANGED','PAYMENT_RECEIVED',
                   'PAYMENT_REFUNDED','RECONCILED','CANCELLED','DELETED')),
  -- TEXT em vez de payment_status — ver header pra contexto
  old_status    text,
  new_status    text,
  old_value     jsonb,
  new_value     jsonb,
  amount_delta  bigint,
  source        text NOT NULL CHECK (source IN
                  ('USER','WEBHOOK','CRON','RECONCILIATION','API','TRIGGER')),
  user_id       text,
  webhook_event_id text REFERENCES webhook_events_log(id) ON DELETE SET NULL,
  metadata      jsonb DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- RLS multi-tenant
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'payment_history' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON payment_history
      USING (company_id = current_setting('app.company_id', true));
  END IF;
END $$;

-- Service role pra trigger inserir bypassando RLS quando contexto da app não existe
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'payment_history' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON payment_history
      TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_history_payment_created
  ON payment_history (payment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_history_company_event
  ON payment_history (company_id, event_type, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger function: payment_history_trigger
-- SECURITY DEFINER pra bypass RLS de payment_history quando trigger insere.
-- EXCEPTION block pra que falha de audit log NÃO quebre a operação em payments.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION payment_history_trigger() RETURNS trigger AS $$
DECLARE
  v_event       text;
  v_old_status  text;
  v_new_status  text;
  v_amount_delta bigint;
BEGIN
  -- Determina event_type baseado em TG_OP e mudança de status
  IF TG_OP = 'INSERT' THEN
    v_event := 'CREATED';
    v_new_status := NEW.status;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      v_event := 'STATUS_CHANGED';
    ELSE
      v_event := 'UPDATED';
    END IF;
    v_old_status := OLD.status;
    v_new_status := NEW.status;
    -- Calcula delta de amount caso paid_amount tenha mudado
    IF OLD.paid_amount IS DISTINCT FROM NEW.paid_amount THEN
      v_amount_delta := COALESCE(NEW.paid_amount, 0) - COALESCE(OLD.paid_amount, 0);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_event := 'DELETED';
    v_old_status := OLD.status;
  END IF;

  -- Inserção isolada em bloco EXCEPTION: falha de audit NÃO quebra operação em payments
  BEGIN
    INSERT INTO payment_history(
      company_id, payment_id, event_type,
      old_status, new_status, old_value, new_value, amount_delta,
      source, user_id
    ) VALUES (
      COALESCE(NEW.company_id, OLD.company_id),
      COALESCE(NEW.id, OLD.id),
      v_event,
      v_old_status, v_new_status,
      CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
      v_amount_delta,
      COALESCE(NULLIF(current_setting('app.audit_source', true), ''), 'TRIGGER'),
      NULLIF(current_setting('app.user_id', true), '')
    );
  EXCEPTION
    WHEN OTHERS THEN
      -- Log warning mas não interrompe transação principal (UPDATE em payments segue)
      RAISE WARNING 'payment_history_trigger failed for payment_id=% event=%: % (%)',
        COALESCE(NEW.id, OLD.id), v_event, SQLERRM, SQLSTATE;
  END;

  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Anexa trigger em payments (idempotente)
DROP TRIGGER IF EXISTS trg_payments_audit ON payments;
CREATE TRIGGER trg_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION payment_history_trigger();

COMMIT;
