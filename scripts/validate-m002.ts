/**
 * Validação M-002 (expand columns) — confirma estado pós-migration.
 * One-shot, descartável.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EXPECTED_NEW_COLUMNS = [
  'kind', 'origin_type', 'origin_id', 'external_provider', 'external_reference',
  'supplier_id', 'chart_account_id', 'cost_center_id',
  'total_amount', 'paid_amount', 'fee_amount', 'discount_amount', 'interest_amount',
  'issue_date', 'due_date', 'expected_date',
  'payment_method', 'pix_payload', 'receipt_url',
  'installment_number', 'installment_total', 'parent_payment_id',
  'card_fee_total', 'card_brand', 'card_nsu', 'card_authorization',
  'anticipated_at', 'anticipation_fee', 'anticipated_amount',
  'version', 'description', 'notes', 'custom_data', 'deleted_at',
] as const

const EXPECTED_NEW_INDEXES = [
  'idx_payments_company_status_due',
  'idx_payments_company_kind_due',
  'idx_payments_origin',
  'idx_payments_external_provider',
  'idx_payments_customer',
  'idx_payments_supplier',
  'idx_payments_overdue_scan',
  'idx_payments_expected_cashflow',
] as const

async function main() {
  console.log('='.repeat(70))
  console.log('Validação M-002 — payments v2 expand columns')
  console.log('='.repeat(70))

  // 1. Colunas
  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='payments'
  `
  const colSet = new Set(cols.map(c => c.column_name))
  const missingCols = EXPECTED_NEW_COLUMNS.filter(c => !colSet.has(c))
  console.log(`\n[COLUMNS] esperadas: ${EXPECTED_NEW_COLUMNS.length}, encontradas: ${EXPECTED_NEW_COLUMNS.length - missingCols.length}`)
  for (const c of EXPECTED_NEW_COLUMNS) {
    console.log(`  ${colSet.has(c) ? 'OK' : 'MISSING'} ${c}`)
  }

  // 2. Índices
  const idxs = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='payments'
  `
  const idxSet = new Set(idxs.map(i => i.indexname))
  const missingIdxs = EXPECTED_NEW_INDEXES.filter(i => !idxSet.has(i))
  console.log(`\n[INDEXES] esperados: ${EXPECTED_NEW_INDEXES.length}, encontrados: ${EXPECTED_NEW_INDEXES.length - missingIdxs.length}`)
  for (const i of EXPECTED_NEW_INDEXES) {
    console.log(`  ${idxSet.has(i) ? 'OK' : 'MISSING'} ${i}`)
  }

  // 3. Trigger
  const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger WHERE tgname='trg_payments_updated_at'
  `
  console.log(`\n[TRIGGER] trg_payments_updated_at: ${triggers.length > 0 ? 'OK' : 'MISSING'}`)

  // 4. FK self-reference
  const fks = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE conname='payments_parent_payment_id_fkey'
  `
  console.log(`[FK] payments_parent_payment_id_fkey: ${fks.length > 0 ? 'OK' : 'MISSING'}`)

  // 5. Sanity — dados existentes não foram tocados
  const rowCount = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM payments
  `
  console.log(`\n[DATA] payments rows: ${rowCount[0].count} (esperado: 56 — sem perda)`)

  // 6. Resumo
  const totalIssues = missingCols.length + missingIdxs.length + (triggers.length === 0 ? 1 : 0) + (fks.length === 0 ? 1 : 0)
  console.log('='.repeat(70))
  if (totalIssues === 0 && rowCount[0].count === 56n) {
    console.log('PASS — M-002 aplicada com sucesso. 0 dados perdidos.')
  } else {
    console.log(`FAIL — ${totalIssues} problema(s). Investigar antes de prosseguir.`)
    process.exitCode = 1
  }
}

main().catch(err => {
  console.error('Erro:', err)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
