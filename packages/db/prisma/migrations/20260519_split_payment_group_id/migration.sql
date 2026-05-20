-- Split payment support — adiciona group_id em accounts_payable (paridade com
-- accounts_receivable.group_id que ja existe) + indexes pra busca por grupo.
--
-- Quando cliente paga em formas diferentes (ex: 500 PIX + 200 cartao 2x),
-- criamos N receivables com mesmo group_id. Mesmo padrao pra contas a pagar
-- (despesa paga parcial em formas diferentes).
--
-- Idempotente: usa IF NOT EXISTS / IF NOT EXISTS pra rodar sem erro em deploys
-- que ja aplicaram parcialmente.

ALTER TABLE accounts_payable
  ADD COLUMN IF NOT EXISTS group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_accounts_payable_company_group
  ON accounts_payable(company_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_receivable_company_group
  ON accounts_receivable(company_id, group_id)
  WHERE group_id IS NOT NULL;
