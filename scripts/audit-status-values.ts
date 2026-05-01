import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const r = await p.$queryRaw<{ status: string; count: bigint }[]>`
    SELECT status, COUNT(*) AS count FROM payments GROUP BY status ORDER BY count DESC
  `
  console.log('Valores de payments.status em produção:')
  for (const row of r) console.log(`  ${row.status.padEnd(20)} ${row.count}`)

  const m = await p.$queryRaw<{ method: string | null; count: bigint }[]>`
    SELECT method, COUNT(*) AS count FROM payments GROUP BY method ORDER BY count DESC
  `
  console.log('\nValores de payments.method:')
  for (const row of m) console.log(`  ${(row.method ?? '<null>').padEnd(20)} ${row.count}`)

  const pr = await p.$queryRaw<{ provider: string | null; count: bigint }[]>`
    SELECT provider, COUNT(*) AS count FROM payments GROUP BY provider ORDER BY count DESC
  `
  console.log('\nValores de payments.provider:')
  for (const row of pr) console.log(`  ${(row.provider ?? '<null>').padEnd(20)} ${row.count}`)
}
main().catch(console.error).finally(() => p.$disconnect())
