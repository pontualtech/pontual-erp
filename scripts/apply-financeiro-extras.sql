-- ═════════════════════════════════════════════════════════════════════════════
-- apply-financeiro-extras.sql
--
-- Aplica extras do refactor financeiro v2 que Prisma db push NÃO suporta
-- nativamente: RLS policies, triggers, materialized views, generated columns,
-- e seed inicial.
--
-- IDEMPOTENTE — pode rodar N vezes sem efeito colateral. Roda no startup do
-- container APÓS prisma db push.
--
-- Spec: squads/financeiro-restructure-spec/output/architecture-spec.md
-- ═════════════════════════════════════════════════════════════════════════════

-- Não usamos BEGIN; explicitamente — Postgres faz transação implícita.
-- Erro em qualquer step → rollback automático e startup abortado (queremos isso).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger function genérica trg_set_updated_at (reusada por várias tabelas)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS em payments + trigger updated_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_tenant_isolation ON payments;
DROP POLICY IF EXISTS payments_service_role ON payments;

-- Tenant isolation pra queries normais. NÃO ATIVADO STRICT ainda — middleware
-- da app precisa setar app.company_id ANTES de queries. Em transição (M-007),
-- política permite NULL (current_setting com 2º arg true retorna NULL se não set).
CREATE POLICY payments_tenant_isolation ON payments
  USING (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.company_id', true) IS NULL
    OR current_setting('app.company_id', true) = ''
  );

-- Service role bypass (jobs internos, webhook handler, scripts admin)
CREATE POLICY payments_service_role ON payments
  TO service_role
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS em payment_history + trigger updated_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_history_tenant_isolation ON payment_history;
DROP POLICY IF EXISTS payment_history_service_role ON payment_history;

CREATE POLICY payment_history_tenant_isolation ON payment_history
  USING (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.company_id', true) IS NULL
    OR current_setting('app.company_id', true) = ''
  );

CREATE POLICY payment_history_service_role ON payment_history
  TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger payment_history_trigger (audit log automático)
-- EXCEPTION-safe: falha de audit NÃO quebra operação em payments.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION payment_history_trigger() RETURNS trigger AS $$
DECLARE
  v_event       text;
  v_old_status  text;
  v_new_status  text;
  v_amount_delta bigint;
BEGIN
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
    IF OLD.paid_amount IS DISTINCT FROM NEW.paid_amount THEN
      v_amount_delta := COALESCE(NEW.paid_amount, 0) - COALESCE(OLD.paid_amount, 0);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_event := 'DELETED';
    v_old_status := OLD.status;
  END IF;

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
      RAISE WARNING 'payment_history_trigger failed for payment_id=% event=%: % (%)',
        COALESCE(NEW.id, OLD.id), v_event, SQLERRM, SQLSTATE;
  END;

  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_payments_audit ON payments;
CREATE TRIGGER trg_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payment_history_trigger();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS em webhook_events_log
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE webhook_events_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_events_log_tenant_isolation ON webhook_events_log;
DROP POLICY IF EXISTS webhook_events_log_service_role ON webhook_events_log;

CREATE POLICY webhook_events_log_tenant_isolation ON webhook_events_log
  USING (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.company_id', true) IS NULL
    OR current_setting('app.company_id', true) = ''
  );

CREATE POLICY webhook_events_log_service_role ON webhook_events_log
  TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS em accounts_chart + trigger updated_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE accounts_chart ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_chart_tenant_isolation ON accounts_chart;
DROP POLICY IF EXISTS accounts_chart_service_role ON accounts_chart;

CREATE POLICY accounts_chart_tenant_isolation ON accounts_chart
  USING (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.company_id', true) IS NULL
    OR current_setting('app.company_id', true) = ''
  )
  WITH CHECK (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.company_id', true) IS NULL
    OR current_setting('app.company_id', true) = ''
  );

CREATE POLICY accounts_chart_service_role ON accounts_chart
  TO service_role
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_accounts_chart_updated_at ON accounts_chart;
CREATE TRIGGER trg_accounts_chart_updated_at
  BEFORE UPDATE ON accounts_chart
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS em fiscal_entries + GENERATED column fiscal_period
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE fiscal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_entries_tenant_isolation ON fiscal_entries;
DROP POLICY IF EXISTS fiscal_entries_service_role ON fiscal_entries;

CREATE POLICY fiscal_entries_tenant_isolation ON fiscal_entries
  USING (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.company_id', true) IS NULL
    OR current_setting('app.company_id', true) = ''
  )
  WITH CHECK (
    company_id = current_setting('app.company_id', true)
    OR current_setting('app.company_id', true) IS NULL
    OR current_setting('app.company_id', true) = ''
  );

CREATE POLICY fiscal_entries_service_role ON fiscal_entries
  TO service_role
  USING (true) WITH CHECK (true);

-- Adiciona fiscal_period como GENERATED column se não existir
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='fiscal_entries' AND column_name='fiscal_period'
  ) THEN
    ALTER TABLE fiscal_entries
      ADD COLUMN fiscal_period text GENERATED ALWAYS AS (to_char(entry_date,'YYYY-MM')) STORED;
    CREATE INDEX idx_fiscal_company_period_account
      ON fiscal_entries (company_id, fiscal_period, chart_account_id);
  END IF;
END $$;

-- CHECK constraint pra source válido
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='chk_fiscal_source' AND conrelid='fiscal_entries'::regclass
  ) THEN
    ALTER TABLE fiscal_entries
      ADD CONSTRAINT chk_fiscal_source CHECK (source IN
        ('PAYMENT','MANUAL_ADJUSTMENT','TAX_CALC','PROVISIONING'));
  END IF;
END $$;

-- CHECK pra amount não-zero
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='chk_fiscal_amount_nonzero' AND conrelid='fiscal_entries'::regclass
  ) THEN
    ALTER TABLE fiscal_entries
      ADD CONSTRAINT chk_fiscal_amount_nonzero CHECK (amount <> 0);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Materialized View dre_monthly
-- ─────────────────────────────────────────────────────────────────────────────

DROP MATERIALIZED VIEW IF EXISTS dre_monthly;
CREATE MATERIALIZED VIEW dre_monthly AS
SELECT
  fe.company_id,
  fe.fiscal_period,
  ac.account_type,
  ac.code,
  ac.name,
  SUM(fe.amount)::bigint AS total_cents
FROM fiscal_entries fe
JOIN accounts_chart ac ON ac.id = fe.chart_account_id
WHERE fe.is_provisional = false
GROUP BY fe.company_id, fe.fiscal_period, ac.account_type, ac.code, ac.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dre_monthly_pk
  ON dre_monthly (company_id, fiscal_period, code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. CHECK constraints em payment_history (event_type, source)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='chk_payment_history_event_type' AND conrelid='payment_history'::regclass
  ) THEN
    ALTER TABLE payment_history
      ADD CONSTRAINT chk_payment_history_event_type CHECK (event_type IN
        ('CREATED','UPDATED','STATUS_CHANGED','PAYMENT_RECEIVED',
         'PAYMENT_REFUNDED','RECONCILED','CANCELLED','DELETED'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='chk_payment_history_source' AND conrelid='payment_history'::regclass
  ) THEN
    ALTER TABLE payment_history
      ADD CONSTRAINT chk_payment_history_source CHECK (source IN
        ('USER','WEBHOOK','CRON','RECONCILIATION','API','TRIGGER'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. CHECK constraints em accounts_chart (auto-referência)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='chk_chart_no_self_parent' AND conrelid='accounts_chart'::regclass
  ) THEN
    ALTER TABLE accounts_chart
      ADD CONSTRAINT chk_chart_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Seed PontualTech (plano de contas) — idempotente via ON CONFLICT
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO accounts_chart (company_id, code, name, account_type, is_synthetic, display_order) VALUES
  ('pontualtech-001','1',     'Receitas',                       'REVENUE',           true,  10),
  ('pontualtech-001','1.1',   'Receita de Servicos',            'REVENUE',           true,  11),
  ('pontualtech-001','1.1.01','Reparo de Impressoras',          'REVENUE',           false, 12),
  ('pontualtech-001','1.1.02','Manutencao Preventiva',          'REVENUE',           false, 13),
  ('pontualtech-001','1.1.03','Coleta e Entrega',               'REVENUE',           false, 14),
  ('pontualtech-001','1.2',   'Receita de Vendas',              'REVENUE',           true,  15),
  ('pontualtech-001','1.2.01','Venda de Pecas',                 'REVENUE',           false, 16),
  ('pontualtech-001','1.2.02','Venda de Insumos',               'REVENUE',           false, 17),
  ('pontualtech-001','2',     'Deducoes da Receita',            'DEDUCTION',         true,  20),
  ('pontualtech-001','2.1',   'Cancelamentos / Devolucoes',     'DEDUCTION',         false, 21),
  ('pontualtech-001','3',     'Custo dos Servicos Vendidos',    'COGS',              true,  30),
  ('pontualtech-001','3.1',   'Pecas e Insumos',                'COGS',              false, 31),
  ('pontualtech-001','3.2',   'Mao de Obra Direta',             'COGS',              false, 32),
  ('pontualtech-001','4',     'Despesas Operacionais',          'OPERATING_EXPENSE', true,  40),
  ('pontualtech-001','4.1',   'Aluguel',                        'OPERATING_EXPENSE', false, 41),
  ('pontualtech-001','4.2',   'Salarios e Encargos',            'OPERATING_EXPENSE', false, 42),
  ('pontualtech-001','4.3',   'Energia / Agua / Internet',      'OPERATING_EXPENSE', false, 43),
  ('pontualtech-001','4.4',   'Marketing e Publicidade',        'OPERATING_EXPENSE', false, 44),
  ('pontualtech-001','4.5',   'Software / SaaS',                'OPERATING_EXPENSE', false, 45),
  ('pontualtech-001','4.6',   'Combustivel / Veiculos',         'OPERATING_EXPENSE', false, 46),
  ('pontualtech-001','5',     'Impostos',                       'TAX',               true,  50),
  ('pontualtech-001','5.1',   'ISS',                            'TAX',               false, 51),
  ('pontualtech-001','5.2',   'PIS / COFINS',                   'TAX',               false, 52),
  ('pontualtech-001','5.3',   'IRPJ / CSLL',                    'TAX',               false, 53),
  ('pontualtech-001','5.4',   'Taxas Bancarias',                'TAX',               false, 54),
  ('pontualtech-001','6',     'Receitas / Despesas Financeiras','FINANCIAL',         true,  60),
  ('pontualtech-001','6.1',   'Juros Recebidos',                'FINANCIAL',         false, 61),
  ('pontualtech-001','6.2',   'Juros Pagos',                    'FINANCIAL',         false, 62),
  ('pontualtech-001','6.3',   'Taxas de Cartao / Gateway',      'FINANCIAL',         false, 63),
  ('pontualtech-001','7',     'Nao-Operacionais',               'NON_OPERATING',     true,  70),
  ('pontualtech-001','7.1',   'Venda de Ativo Imobilizado',     'NON_OPERATING',     false, 71)
ON CONFLICT (company_id, code) DO NOTHING;
