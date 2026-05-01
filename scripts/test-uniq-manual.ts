import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const eid = `manual-test-${Date.now()}`
  console.log(`Testing event_id=${eid}`)

  // Cleanup
  await p.$executeRaw`DELETE FROM webhook_events_log WHERE event_id = ${eid}`

  // 1ª: deve passar
  await p.$executeRaw`
    INSERT INTO webhook_events_log (company_id, provider, event_id, event_type, raw_payload)
    VALUES ('pontualtech-001', 'ASAAS'::payment_provider, ${eid}, 'PAYMENT_RECEIVED', '{}'::jsonb)
  `
  console.log('1ª insert: OK')

  // 2ª: deve falhar
  try {
    await p.$executeRaw`
      INSERT INTO webhook_events_log (company_id, provider, event_id, event_type, raw_payload)
      VALUES ('pontualtech-001', 'ASAAS'::payment_provider, ${eid}, 'PAYMENT_RECEIVED', '{}'::jsonb)
    `
    console.log('2ª insert: PASSOU (BUG! deveria ter falhado)')
    const r = await p.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM webhook_events_log WHERE event_id = ${eid}`
    console.log(`Total rows com esse event_id: ${r[0].count}`)
  } catch (e: any) {
    console.log(`2ª insert: BLOCKED OK — ${e.code} ${e.message?.slice(0, 200)}`)
  }

  await p.$executeRaw`DELETE FROM webhook_events_log WHERE event_id = ${eid}`
}
main().catch(console.error).finally(() => p.$disconnect())
