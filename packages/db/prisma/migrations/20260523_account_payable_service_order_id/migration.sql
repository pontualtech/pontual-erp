-- Auto-pay taxa cartão: AccountPayable precisa saber qual OS gerou ela (2026-05-23)
--
-- O código em /api/financeiro/contas-receber/[id]/baixa/route.ts:84-117 faz
-- auto-pay da taxa de cartão (AccountPayable) quando o AccountReceivable
-- correspondente é totalmente pago. Pra ligar os dois, precisa de uma chave
-- comum — o service_order_id (que já existe em AccountReceivable).
--
-- Sem isso, build TypeScript falha em commit ba5cfd4 (fix(financeiro): audit
-- massivo) que assumia o campo existia.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Não-destrutivo: NULLABLE — rows antigas ficam NULL (sem auto-pay
-- retroativo), novas pós-deploy começam a ter o link.

ALTER TABLE accounts_payable
  ADD COLUMN IF NOT EXISTS service_order_id TEXT;

-- FK soft (sem cascade strict) — alinhada com padrão de outros campos
-- service_order_id no schema (NoAction onDelete/onUpdate).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'accounts_payable_service_order_id_fkey'
  ) THEN
    ALTER TABLE accounts_payable
      ADD CONSTRAINT accounts_payable_service_order_id_fkey
      FOREIGN KEY (service_order_id) REFERENCES service_orders(id)
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END$$;

-- Index pra query auto-pay (busca por service_order_id + status PENDENTE)
CREATE INDEX IF NOT EXISTS idx_ap_service_order
  ON accounts_payable (service_order_id)
  WHERE service_order_id IS NOT NULL;
