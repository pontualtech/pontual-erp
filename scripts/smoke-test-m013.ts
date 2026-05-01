import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  // Pega um customer real pra teste
  const cust = await p.$queryRaw<{ id: string }[]>`
    SELECT id FROM customers WHERE company_id='pontualtech-001' LIMIT 1`
  if (!cust.length) { console.log('No customer'); return }

  const testId = `test-ar-${Date.now()}`
  console.log(`[1] INSERT em accounts_receivable id=${testId}`)
  await p.$executeRaw`
    INSERT INTO accounts_receivable
      (id, company_id, customer_id, description, total_amount, due_date, status)
    VALUES
      (${testId}, 'pontualtech-001', ${cust[0].id}, 'Smoke test M-013', 12345, '2026-12-31', 'PENDENTE')`

  // Verifica se trigger criou row em payments
  const inPayments = await p.$queryRaw<{ id: string; kind: string; total_amount: bigint; origin_type: string }[]>`
    SELECT id, kind::text AS kind, total_amount, origin_type FROM payments WHERE id = ${testId}`

  if (inPayments.length === 1) {
    const p1 = inPayments[0]
    console.log(`  ✅ Trigger criou row em payments`)
    console.log(`     kind=${p1.kind}  total_amount=${p1.total_amount}  origin_type=${p1.origin_type}`)
    if (p1.kind !== 'RECEIVABLE') console.log(`  ❌ kind esperado RECEIVABLE`)
    if (Number(p1.total_amount) !== 12345) console.log(`  ❌ total_amount esperado 12345`)
    if (p1.origin_type !== 'ACCOUNT_RECEIVABLE') console.log(`  ❌ origin_type esperado ACCOUNT_RECEIVABLE`)
  } else {
    console.log(`  ❌ Trigger NÃO criou row em payments (count=${inPayments.length})`)
  }

  // UPDATE pra testar trigger update
  console.log(`\n[2] UPDATE em accounts_receivable (status PENDENTE → RECEBIDO)`)
  await p.$executeRaw`UPDATE accounts_receivable SET status = 'RECEBIDO', received_amount = 12345 WHERE id = ${testId}`

  const updated = await p.$queryRaw<{ status: string; paid_amount: bigint | null }[]>`
    SELECT status, paid_amount FROM payments WHERE id = ${testId}`

  if (updated[0]?.status === 'RECEBIDO' && Number(updated[0]?.paid_amount) === 12345) {
    console.log(`  ✅ Trigger propagou update: status=${updated[0].status} paid=${updated[0].paid_amount}`)
  } else {
    console.log(`  ❌ Update não propagou: ${JSON.stringify(updated[0])}`)
  }

  // Cleanup — DELETE em AR (FK CASCADE em payments? não, payments tem REFERENCES service_orders só)
  console.log(`\n[3] CLEANUP`)
  await p.$executeRaw`DELETE FROM payment_history WHERE payment_id = ${testId}`
  await p.$executeRaw`DELETE FROM payments WHERE id = ${testId}`
  await p.$executeRaw`DELETE FROM accounts_receivable WHERE id = ${testId}`
  console.log(`  ✅ Test data removed`)
}

main().catch(e => console.error('FAIL:', e.message)).finally(() => p.$disconnect())
