import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const t = await p.$queryRaw<{ tablename: string; rls: boolean }[]>`
    SELECT t.tablename, c.relrowsecurity AS rls
      FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
     WHERE t.schemaname='public' AND t.tablename IN ('feature_flags','tenant_feature_flags')
     ORDER BY t.tablename`
  console.log(`M-010 tables: ${t.length}/2`)
  for (const r of t) console.log(`  OK ${r.tablename} (RLS=${r.rls})`)
  const cks = await p.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
     WHERE conrelid='feature_flags'::regclass AND contype='c'`
  console.log(`\nfeature_flags CHECK: ${cks.length}`)
  for (const c of cks) console.log(`  ${c.conname}`)
}
main().catch(console.error).finally(() => p.$disconnect())
