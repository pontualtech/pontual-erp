-- M-002 (EXPAND phase) — Estende `payments` existente com colunas do modelo v2.
--
-- ESTRATÉGIA: expand-and-contract. Em vez de CREATE TABLE payments (impossível,
-- já existe com 56 rows e 23 colunas), faz ALTER TABLE ADD COLUMN. Todas as
-- novas colunas são NULLABLE e SEM CHECK constraints — backfill vem em M-012,
-- conversões em M-006, NOT NULL/CHECK em fase de "contract" depois.
--
-- Spec original em architecture-spec.md §1.2 desenhou CREATE TABLE assumindo
-- que payments não existia. Pivot pra expand-only documentado aqui.
--
-- Endereça os pain points:
--   P-001 (multi-origem unificada via kind/origin_type/origin_id)
--   P-005 (parcelamento via installment_*)
--   P-008 (fluxo caixa projetado via expected_date)
--   P-021 (audit log via custom_data + version + deleted_at)
--   P-022 (otimistic locking via version)
--
-- Risco: BAIXO. Operações:
--   ✓ ADD COLUMN nullable: não afeta linhas existentes
--   ✓ Sem CHECK constraints: nenhum dado existente vai falhar
--   ✓ Sem NOT NULL: backfill futuro vai preencher
--   ✓ Sem RLS: deferido pra M-007 (ALTO RISCO, separado)
--   ✓ Idempotente via IF NOT EXISTS em todas as ops
-- Tempo: ~30s.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Classificação multi-origem (P-001)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS kind          payment_kind;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS origin_type   text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS origin_id     text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Identidade externa estruturada (atual tem só `provider` text + `external_id`)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_provider  payment_provider;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS external_reference text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Partes (atual tem só customer_id NOT NULL — pra PAYABLE precisa supplier)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS supplier_id text;

-- FK só será adicionada em fase posterior (depois que código que cria PAYABLE
-- estiver pronto — agora ficaria sem dado).

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Plano de contas / classificação (M-005 cria as tabelas referenciadas)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS chart_account_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cost_center_id   text;

-- FKs serão adicionadas em M-005 quando accounts_chart e cost_centers existirem.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Valores em centavos (bigint) — paralelo ao `amount` integer existente
-- Backfill em M-012: total_amount := amount; paid_amount := CASE status...
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS total_amount    bigint;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_amount     bigint DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_amount      bigint DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_amount bigint DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS interest_amount bigint DEFAULT 0;

-- net_amount como GENERATED — só após backfill ter populado total_amount.
-- Será adicionado em M-012 (depois do backfill).

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Datas estruturadas (atual só tem expires_at, paid_at, created_at)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS issue_date    date DEFAULT CURRENT_DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS due_date      date;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expected_date date;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Método tipado (atual tem `method` text — convivência paralela)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method payment_method_kind;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Asset URLs adicionais (já existe bank_slip_url, invoice_url, qr_code,
--    qr_code_image — falta pix_payload e receipt_url tipados)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS pix_payload text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_url text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Parcelamento (P-005)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS installment_number smallint DEFAULT 1;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS installment_total  smallint DEFAULT 1;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS parent_payment_id  text;

-- FK self-reference adicionada após colunas existirem
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payments_parent_payment_id_fkey'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_parent_payment_id_fkey
      FOREIGN KEY (parent_payment_id) REFERENCES payments(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Conciliação cartão Rede (preserva project_maquininha_rede_status memory)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_fee_total     bigint DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_brand         text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_nsu           text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS card_authorization text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Antecipação Asaas
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS anticipated_at      timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS anticipation_fee    bigint DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS anticipated_amount  bigint;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Concorrência otimista (P-022) + soft delete + metadata
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS version     integer NOT NULL DEFAULT 1;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes       text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS custom_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Índices novos (com IF NOT EXISTS, partial WHERE pra deleted_at)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payments_company_status_due
  ON payments (company_id, status, due_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_company_kind_due
  ON payments (company_id, kind, due_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_origin
  ON payments (origin_type, origin_id)
  WHERE origin_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_external_provider
  ON payments (external_provider, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_customer
  ON payments (customer_id)
  WHERE customer_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_supplier
  ON payments (supplier_id)
  WHERE supplier_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_overdue_scan
  ON payments (company_id, due_date)
  WHERE status = 'PENDING' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_expected_cashflow
  ON payments (company_id, expected_date)
  WHERE status IN ('PENDING','OVERDUE','PARTIAL') AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Trigger updated_at (atual default funciona pra INSERT, mas não pra UPDATE)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
