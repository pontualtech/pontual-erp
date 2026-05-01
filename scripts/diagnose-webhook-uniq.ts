import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  // Lista TODAS constraints da webhook_events_log
  const cs = await p.$queryRaw<{ conname: string; contype: string; pg_get_constraintdef: string }[]>`
    SELECT conname, contype::text, pg_get_constraintdef(oid)
      FROM pg_constraint WHERE conrelid='webhook_events_log'::regclass
     ORDER BY conname`
  console.log('Constraints em webhook_events_log:')
  for (const c of cs) console.log(`  ${c.contype} | ${c.conname}: ${c.pg_get_constraintdef}`)

  // Lista índices
  const ixs = await p.$queryRaw<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename='webhook_events_log'`
  console.log('\nÍndices:')
  for (const i of ixs) console.log(`  ${i.indexname}: ${i.indexdef}`)

  // Conta rows
  const c = await p.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM webhook_events_log`
  console.log(`\nRows: ${c[0].count}`)
}
main().catch(console.error).finally(() => p.$disconnect())
