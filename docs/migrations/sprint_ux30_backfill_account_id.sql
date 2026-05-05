-- Sprint UX-30 (2026-05-05): backfill account_id em accounts_payable
-- Aplicado direto em produção via prisma db execute. Documentado aqui pra
-- referência histórica (não roda no build, apenas archive).
--
-- Restore disponível: tabela accounts_payable_bk_2026_05_04_ux24 (criada Sprint UX-24)
--
-- Resultado:
--   ANTES: 34 rows com account_id IS NULL
--   DEPOIS: 28 rows com account_id IS NULL (6 backfilled para Asaas)
--   - 6 TAXAS PAY_xxx → Asaas (alta certeza, gateway exclusivo)
--   - 20 TAXA CARTÃO genérico → mantém NULL (adquirente histórica desconhecida)
--   - 4 MDR REDE → mantém NULL (não há conta REDE cadastrada)
--   - 4 ANTECIPACAO RA REDE → mantém NULL (idem)

-- Categoria 1: TAXAS PAY_xxx → Asaas
WITH asaas_id AS (
  SELECT id FROM accounts
  WHERE company_id = 'pontualtech-001'
    AND lower(name) IN ('asaas', 'assas')
  LIMIT 1
)
UPDATE accounts_payable
SET account_id = (SELECT id FROM asaas_id),
    updated_at = NOW()
WHERE company_id = 'pontualtech-001'
  AND deleted_at IS NULL
  AND account_id IS NULL
  AND description ~ '^TAXAS PAY_';
