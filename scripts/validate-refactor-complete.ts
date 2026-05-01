import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  console.log('='.repeat(70))
  console.log('VALIDAÇÃO COMPLETA — refactor financeiro v2 + voip persisted')
  console.log('='.repeat(70))

  // 1. Enums
  const enums = await p.$queryRaw<{ typname: string; n_values: number }[]>`
    SELECT t.typname, (SELECT count(*) FROM pg_enum e WHERE e.enumtypid = t.oid)::int AS n_values
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e'
       AND t.typname IN ('payment_kind','payment_status','payment_method_kind','payment_provider',
                          'webhook_event_status','reminder_channel','reminder_status',
                          'chart_account_type','reconciliation_status','feature_flag_strategy')
     ORDER BY t.typname`
  console.log(`\n[ENUMS] ${enums.length}/10`)
  for (const e of enums) console.log(`  OK ${e.typname} (${e.n_values})`)

  // 2. Tabelas refactor
  const tables = await p.$queryRaw<{ tablename: string; rls: boolean }[]>`
    SELECT t.tablename, c.relrowsecurity AS rls
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename
     WHERE t.schemaname='public'
       AND t.tablename IN ('payments','payment_history','webhook_events_log',
                            'accounts_chart','fiscal_entries','voip_extensions')
     ORDER BY t.tablename`
  console.log(`\n[TABLES] ${tables.length}/6`)
  for (const t of tables) console.log(`  OK ${t.tablename} (RLS=${t.rls})`)

  // 3. Trigger audit
  const trigs = await p.$queryRaw<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_payments_audit','trg_payments_updated_at','trg_accounts_chart_updated_at')
     ORDER BY tgname`
  console.log(`\n[TRIGGERS] ${trigs.length}/3`)
  for (const t of trigs) console.log(`  OK ${t.tgname}`)

  // 4. Materialized View
  const mvs = await p.$queryRaw<{ matviewname: string }[]>`
    SELECT matviewname FROM pg_matviews WHERE schemaname='public' AND matviewname='dre_monthly'`
  console.log(`\n[MATERIALIZED VIEWS] ${mvs.length}/1`)
  for (const m of mvs) console.log(`  OK ${m.matviewname}`)

  // 5. Generated column fiscal_period
  const fp = await p.$queryRaw<{ column_name: string; is_generated: string }[]>`
    SELECT column_name, is_generated FROM information_schema.columns
     WHERE table_name='fiscal_entries' AND column_name='fiscal_period'`
  // Após M-008: fiscal_period virou coluna text + trigger BEFORE INSERT/UPDATE
  // (Prisma 5.x não suporta GENERATED ALWAYS declarativo, conflitava com db push).
  // is_generated='NEVER' é o estado esperado; trigger trg_fiscal_entries_period popula.
  console.log(`\n[fiscal_period] type: ${fp[0]?.is_generated || 'MISSING'} (esperado: NEVER, trigger-driven)`)

  // 6. Seed PontualTech
  const seed = await p.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM accounts_chart WHERE company_id='pontualtech-001'`
  console.log(`\n[SEED] accounts_chart pra pontualtech-001: ${seed[0].count}/31`)

  // 7. Voip extensions preservadas
  const voip = await p.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM voip_extensions WHERE company_id='pontualtech-001'`
  console.log(`[VOIP] voip_extensions: ${voip[0].count}/15`)

  // 8. Payments rows preservadas
  const pay = await p.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM payments`
  console.log(`[PAYMENTS] rows: ${pay[0].count}`)

  // 9. Smoke test trigger
  const sample = await p.$queryRaw<{ id: string }[]>`SELECT id FROM payments LIMIT 1`
  if (sample.length > 0) {
    const before = await p.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM payment_history WHERE payment_id = ${sample[0].id}`
    await p.$executeRaw`UPDATE payments SET description = description WHERE id = ${sample[0].id}`
    const after = await p.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM payment_history WHERE payment_id = ${sample[0].id}`
    const delta = Number(after[0].count) - Number(before[0].count)
    console.log(`\n[SMOKE TEST] UPDATE no-op em payment ${sample[0].id}: history rows +${delta} (esperado: +1)`)
  }

  console.log('='.repeat(70))
  const allOk = enums.length === 10 && tables.length === 6 && trigs.length === 3 && mvs.length === 1 &&
    fp[0]?.is_generated === 'NEVER' && Number(seed[0].count) === 31
  console.log(allOk ? 'PASS — refactor v2 completo e persistente.' : 'FAIL — investigar')
}
main().catch(console.error).finally(() => p.$disconnect())
