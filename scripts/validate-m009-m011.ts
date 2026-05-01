import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const t = await p.$queryRaw<{ tablename: string; rls: boolean }[]>`
    SELECT t.tablename, c.relrowsecurity AS rls
      FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
     WHERE t.schemaname='public'
       AND t.tablename IN ('payment_method_configs','payment_terms','reconciliation_batches','reconciliation_entries')
     ORDER BY t.tablename`
  console.log(`Novas tabelas M-009+M-011: ${t.length}/4`)
  for (const r of t) console.log(`  OK ${r.tablename} (RLS=${r.rls})`)

  const ck = await p.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
     WHERE conrelid IN (
       'payment_method_configs'::regclass,
       'payment_terms'::regclass,
       'reconciliation_batches'::regclass,
       'reconciliation_entries'::regclass
     ) AND contype='c'
     ORDER BY conname`
  console.log(`\nCHECK constraints: ${ck.length}`)
  for (const c of ck) console.log(`  ${c.conname}`)

  const idxLegacy = await p.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
     WHERE tablename IN ('accounts_receivable','accounts_payable')
       AND indexname LIKE 'idx_a%'`
  console.log(`\nÍndices legacy (M-009): ${idxLegacy.length}/4`)
  for (const i of idxLegacy) console.log(`  OK ${i.indexname}`)
}
main().catch(console.error).finally(() => p.$disconnect())
