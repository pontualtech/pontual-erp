-- ROLLBACK M-002 EXPAND — remove colunas, índices, trigger e FK adicionados.
--
-- Seguro ENQUANTO M-012 (backfill) NÃO foi aplicada. Após backfill, dados
-- podem estar nas colunas novas — rollback aqui perde esses dados.
--
-- Para rollback completo pós-backfill: PRIMEIRO rodar reverso da M-012,
-- DEPOIS este down.sql.

BEGIN;

-- 14. Trigger
DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
-- Não dropamos a function trg_set_updated_at — pode ser usada por outras tabelas.

-- 13. Índices novos (em ordem reversa de criação)
DROP INDEX IF EXISTS idx_payments_expected_cashflow;
DROP INDEX IF EXISTS idx_payments_overdue_scan;
DROP INDEX IF EXISTS idx_payments_supplier;
DROP INDEX IF EXISTS idx_payments_customer;
DROP INDEX IF EXISTS idx_payments_external_provider;
DROP INDEX IF EXISTS idx_payments_origin;
DROP INDEX IF EXISTS idx_payments_company_kind_due;
DROP INDEX IF EXISTS idx_payments_company_status_due;

-- 12.
ALTER TABLE payments DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE payments DROP COLUMN IF EXISTS custom_data;
ALTER TABLE payments DROP COLUMN IF EXISTS notes;
ALTER TABLE payments DROP COLUMN IF EXISTS description;
ALTER TABLE payments DROP COLUMN IF EXISTS version;

-- 11.
ALTER TABLE payments DROP COLUMN IF EXISTS anticipated_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS anticipation_fee;
ALTER TABLE payments DROP COLUMN IF EXISTS anticipated_at;

-- 10.
ALTER TABLE payments DROP COLUMN IF EXISTS card_authorization;
ALTER TABLE payments DROP COLUMN IF EXISTS card_nsu;
ALTER TABLE payments DROP COLUMN IF EXISTS card_brand;
ALTER TABLE payments DROP COLUMN IF EXISTS card_fee_total;

-- 9. (FK self-reference primeiro, depois colunas)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_parent_payment_id_fkey;
ALTER TABLE payments DROP COLUMN IF EXISTS parent_payment_id;
ALTER TABLE payments DROP COLUMN IF EXISTS installment_total;
ALTER TABLE payments DROP COLUMN IF EXISTS installment_number;

-- 8.
ALTER TABLE payments DROP COLUMN IF EXISTS receipt_url;
ALTER TABLE payments DROP COLUMN IF EXISTS pix_payload;

-- 7.
ALTER TABLE payments DROP COLUMN IF EXISTS payment_method;

-- 6.
ALTER TABLE payments DROP COLUMN IF EXISTS expected_date;
ALTER TABLE payments DROP COLUMN IF EXISTS due_date;
ALTER TABLE payments DROP COLUMN IF EXISTS issue_date;

-- 5.
ALTER TABLE payments DROP COLUMN IF EXISTS interest_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS discount_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS fee_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS paid_amount;
ALTER TABLE payments DROP COLUMN IF EXISTS total_amount;

-- 4.
ALTER TABLE payments DROP COLUMN IF EXISTS cost_center_id;
ALTER TABLE payments DROP COLUMN IF EXISTS chart_account_id;

-- 3.
ALTER TABLE payments DROP COLUMN IF EXISTS supplier_id;

-- 2.
ALTER TABLE payments DROP COLUMN IF EXISTS external_reference;
ALTER TABLE payments DROP COLUMN IF EXISTS external_provider;

-- 1.
ALTER TABLE payments DROP COLUMN IF EXISTS origin_id;
ALTER TABLE payments DROP COLUMN IF EXISTS origin_type;
ALTER TABLE payments DROP COLUMN IF EXISTS kind;

COMMIT;
