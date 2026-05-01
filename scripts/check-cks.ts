import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const cks = await p.$queryRaw<{ relname: string; conname: string }[]>`
    SELECT t.relname, c.conname FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.contype = 'c'
       AND t.relname IN ('payment_method_configs','payment_terms','reconciliation_batches','reconciliation_entries')
     ORDER BY t.relname, c.conname`
  console.log(`CHECK constraints novas: ${cks.length}`)
  for (const r of cks) console.log(`  ${r.relname}.${r.conname}`)
}
main().catch(console.error).finally(() => p.$disconnect())
