/**
 * Validação M-004 — payment_history + trigger automática.
 *
 * Testa scenarios:
 *   1. Tabela existe + RLS + 2 policies + 2 indexes
 *   2. Trigger anexada em payments
 *   3. Function existe (SECURITY DEFINER)
 *   4. SMOKE TEST: UPDATE em payment real → linha aparece em payment_history
 *      (UPDATE no-op de description='description' pra não alterar dados reais)
 */

import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  console.log('='.repeat(70))
  console.log('Validação M-004 — payment_history + trigger automática')
  console.log('='.repeat(70))

  // 1. Schema checks
  const checks = await p.$queryRaw<{
    table_exists: number; rls: boolean; policies: number; indexes: number;
    trigger_exists: number; func_exists: number;
  }[]>`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='payment_history')::int AS table_exists,
      (SELECT relrowsecurity FROM pg_class WHERE relname='payment_history') AS rls,
      (SELECT COUNT(*) FROM pg_policies WHERE tablename='payment_history')::int AS policies,
      (SELECT COUNT(*) FROM pg_indexes WHERE tablename='payment_history')::int AS indexes,
      (SELECT COUNT(*) FROM pg_trigger WHERE tgname='trg_payments_audit')::int AS trigger_exists,
      (SELECT COUNT(*) FROM pg_proc WHERE proname='payment_history_trigger')::int AS func_exists
  `
  const c = checks[0]
  console.log(`[SCHEMA]`)
  console.log(`  table_exists:    ${c.table_exists} (esperado: 1)`)
  console.log(`  rls:             ${c.rls} (esperado: true)`)
  console.log(`  policies:        ${c.policies} (esperado: 2)`)
  console.log(`  indexes:         ${c.indexes} (esperado: 3 — pkey + 2 idx)`)
  console.log(`  trigger_exists:  ${c.trigger_exists} (esperado: 1)`)
  console.log(`  func_exists:     ${c.func_exists} (esperado: 1)`)

  // 2. Smoke test: pegar 1 payment existente, UPDATE no-op,
  //    verificar que linha apareceu em payment_history.
  const sample = await p.$queryRaw<{ id: string; company_id: string; description: string | null }[]>`
    SELECT id, company_id, description FROM payments LIMIT 1
  `
  if (sample.length === 0) {
    console.log('\n[SMOKE TEST] SKIPPED — payments table está vazia.')
    return
  }
  const target = sample[0]
  console.log(`\n[SMOKE TEST] Update no-op em payment ${target.id} (company ${target.company_id})`)

  const beforeCount = await p.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM payment_history WHERE payment_id = ${target.id}
  `

  // No-op: description = description. Trigger AFTER UPDATE dispara mesmo que valor não mude.
  // Mas TG_OP=UPDATE só vai disparar se algo realmente mudou? Postgres dispara ON UPDATE
  // pra QUALQUER UPDATE statement, mesmo que valores sejam idênticos.
  await p.$executeRaw`UPDATE payments SET description = description WHERE id = ${target.id}`

  const afterCount = await p.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM payment_history WHERE payment_id = ${target.id}
  `

  const delta = Number(afterCount[0].count) - Number(beforeCount[0].count)
  console.log(`  history rows antes:  ${beforeCount[0].count}`)
  console.log(`  history rows depois: ${afterCount[0].count}`)
  console.log(`  delta:               +${delta} (esperado: +1)`)

  // 3. Inspect última row pra ver se conteúdo está correto
  const last = await p.$queryRaw<{ event_type: string; old_status: string | null; new_status: string | null; source: string }[]>`
    SELECT event_type, old_status, new_status, source
      FROM payment_history
     WHERE payment_id = ${target.id}
     ORDER BY created_at DESC
     LIMIT 1
  `
  if (last.length > 0) {
    const h = last[0]
    console.log(`  última row: event=${h.event_type} old=${h.old_status} new=${h.new_status} source=${h.source}`)
  }

  console.log('='.repeat(70))
  const ok =
    c.table_exists === 1 && c.rls && c.policies === 2 && c.indexes === 3 &&
    c.trigger_exists === 1 && c.func_exists === 1 && delta === 1
  console.log(ok ? 'PASS — M-004 funcional' : 'FAIL — investigar')
  if (!ok) process.exitCode = 1
}

main().catch(console.error).finally(() => p.$disconnect())
