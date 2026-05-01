import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const tables = await p.$queryRaw<{ tablename: string; rls: boolean }[]>`
    SELECT t.tablename, c.relrowsecurity AS rls
      FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
     WHERE t.schemaname='public'
       AND t.tablename IN ('cobranca_rules','cobranca_rule_steps','payment_reminders')
     ORDER BY t.tablename
  `
  console.log(`M-008 tables: ${tables.length}/3`)
  for (const t of tables) console.log(`  OK ${t.tablename} (RLS=${t.rls})`)
  const constraints = await p.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
     WHERE conrelid IN ('cobranca_rule_steps'::regclass, 'payment_reminders'::regclass, 'cobranca_rules'::regclass)
       AND contype='c'`
  console.log(`\nCHECK constraints: ${constraints.length}`)
  for (const c of constraints) console.log(`  ${c.conname}`)
}
main().catch(console.error).finally(() => p.$disconnect())
