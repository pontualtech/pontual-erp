import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const ix = await p.$queryRaw<{ tablename: string; indexname: string }[]>`
    SELECT tablename, indexname FROM pg_indexes
     WHERE tablename IN ('accounts_receivable','accounts_payable')
     ORDER BY tablename, indexname`
  console.log(`Total índices em AR/AP: ${ix.length}`)
  for (const r of ix) console.log(`  ${r.tablename}: ${r.indexname}`)
}
main().catch(console.error).finally(() => p.$disconnect())
