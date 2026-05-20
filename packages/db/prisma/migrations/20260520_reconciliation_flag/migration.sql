-- Reconciliation flag em AR/AP — distingue "declarado como pago" (motorista,
-- balcao, cadastro manual) de "confirmado no extrato bancario" (webhook Asaas,
-- match OFX/CNAB, match Rede).
--
-- Fluxo:
--   * Motorista marca PIX recebido → status='PAGO', reconciled=false (amarelo na UI)
--   * Webhook Asaas confirma PIX/boleto/cartao → reconciled=true (verde)
--   * Conciliacao match OFX/CNAB → reconciled=true (verde)
--
-- Backfill: PAGOs/RECEBIDOs antigos sao marcados reconciled=true pois usuario
-- confirmou que todos os pagos atuais no sistema ja foram conferidos.
--
-- Idempotente: IF NOT EXISTS pra suportar re-run sem erro.

ALTER TABLE accounts_receivable
  ADD COLUMN IF NOT EXISTS reconciled BOOLEAN DEFAULT false;

ALTER TABLE accounts_payable
  ADD COLUMN IF NOT EXISTS reconciled BOOLEAN DEFAULT false;

-- Backfill: tudo que ja esta PAGO/RECEBIDO no sistema atual considera-se
-- conciliado (usuario confirmou). Novos PAGOs a partir daqui entram com
-- reconciled=false ate confirmacao no extrato.
UPDATE accounts_receivable
  SET reconciled = true
  WHERE status IN ('PAGO', 'RECEBIDO')
    AND reconciled IS NOT TRUE;

UPDATE accounts_payable
  SET reconciled = true
  WHERE status IN ('PAGO', 'RECEBIDO')
    AND reconciled IS NOT TRUE;

-- Index parcial pra busca "PAGOs aguardando conciliacao" (fila do financeiro).
CREATE INDEX IF NOT EXISTS idx_ar_company_pending_reconciliation
  ON accounts_receivable(company_id, updated_at DESC)
  WHERE status IN ('PAGO', 'RECEBIDO') AND reconciled IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_ap_company_pending_reconciliation
  ON accounts_payable(company_id, updated_at DESC)
  WHERE status IN ('PAGO', 'RECEBIDO') AND reconciled IS NOT TRUE;
