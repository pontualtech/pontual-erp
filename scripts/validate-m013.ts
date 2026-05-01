import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const t = await p.$queryRaw<{ tgname: string; relname: string }[]>`
    SELECT tg.tgname, c.relname FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
     WHERE tg.tgname IN ('trg_ar_dual_write','trg_ap_dual_write')`
  console.log(`Triggers dual-write: ${t.length}/2`)
  for (const r of t) console.log(`  OK ${r.tgname} on ${r.relname}`)

  const f = await p.$queryRaw<{ proname: string }[]>`
    SELECT proname FROM pg_proc WHERE proname IN ('dual_write_ar_to_payments','dual_write_ap_to_payments')`
  console.log(`Functions: ${f.length}/2`)
  for (const r of f) console.log(`  OK ${r.proname}`)
}
main().catch(console.error).finally(() => p.$disconnect())
