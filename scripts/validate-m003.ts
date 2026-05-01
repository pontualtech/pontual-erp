import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const idx = await p.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename='webhook_events_log' ORDER BY indexname
  `
  console.log('Índices da webhook_events_log:')
  for (const i of idx) console.log(`  ${i.indexname}`)
  const expected = new Set([
    'webhook_events_log_pkey',
    'uniq_provider_event',
    'idx_webhook_company_received',
    'idx_webhook_status',
    'idx_webhook_payment',
  ])
  const found = new Set(idx.map(i => i.indexname))
  const missing = [...expected].filter(e => !found.has(e))
  const extra = [...found].filter(f => !expected.has(f))
  if (missing.length === 0 && extra.length === 0) {
    console.log('PASS - 5 índices corretos.')
  } else {
    console.log(`FAIL - missing: ${missing.join(',')} extra: ${extra.join(',')}`)
    process.exitCode = 1
  }
}
main().catch(console.error).finally(() => p.$disconnect())
