import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  console.log('='.repeat(72))
  console.log('SPRINT 1 FINAL — Validação prod refactor financeiro v2')
  console.log('='.repeat(72))

  // Enums (M-001)
  const enums = await p.$queryRaw<{ typname: string }[]>`
    SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
     WHERE n.nspname='public' AND t.typtype='e'
       AND t.typname IN ('payment_kind','payment_status','payment_method_kind','payment_provider',
                          'webhook_event_status','reminder_channel','reminder_status',
                          'chart_account_type','reconciliation_status','feature_flag_strategy')`
  console.log(`[M-001] Enums:               ${enums.length}/10 ${enums.length === 10 ? 'OK' : 'FAIL'}`)

  // Tabelas refactor (M-002 + M-003 + M-004 + M-005 + M-008 + M-010)
  const refactorTables = ['payments', 'payment_history', 'webhook_events_log', 'accounts_chart',
    'fiscal_entries', 'cobranca_rules', 'cobranca_rule_steps', 'payment_reminders',
    'feature_flags', 'tenant_feature_flags']
  const tables = await p.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname='public'
       AND tablename = ANY(${refactorTables})`
  console.log(`[M-002..M-010] Tables:       ${tables.length}/${refactorTables.length} ${tables.length === refactorTables.length ? 'OK' : 'FAIL'}`)

  // RLS (deve estar em todas exceto feature_flags)
  const rls = await p.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM pg_class
     WHERE relname = ANY(${refactorTables}) AND relrowsecurity = true`
  console.log(`[RLS] Tables com RLS:        ${rls[0].count}/9 (feature_flags é global, sem RLS) ${Number(rls[0].count) === 9 ? 'OK' : 'FAIL'}`)

  // Triggers (M-004 audit + updated_at em 3 tabelas)
  const trigs = await p.$queryRaw<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger
     WHERE tgname IN ('trg_payments_audit','trg_payments_updated_at','trg_accounts_chart_updated_at',
                       'trg_cobranca_rules_updated_at','trg_fiscal_entries_period')`
  console.log(`[Triggers]                   ${trigs.length}/5 ${trigs.length >= 4 ? 'OK' : 'FAIL'}`)
  for (const t of trigs) console.log(`    OK ${t.tgname}`)

  // MV
  const mv = await p.$queryRaw<{ matviewname: string }[]>`
    SELECT matviewname FROM pg_matviews WHERE matviewname='dre_monthly'`
  console.log(`[Materialized View dre_monthly] ${mv.length}/1 ${mv.length === 1 ? 'OK' : 'FAIL'}`)

  // Seed
  const seed = await p.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM accounts_chart WHERE company_id='pontualtech-001'`
  console.log(`[Seed plano contas]          ${seed[0].count}/31 ${Number(seed[0].count) === 31 ? 'OK' : 'FAIL'}`)

  // Voip preservado
  const voip = await p.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM voip_extensions WHERE company_id='pontualtech-001'`
  console.log(`[Voip preservados]           ${voip[0].count}/15 ${Number(voip[0].count) === 15 ? 'OK' : 'FAIL'}`)

  // Payments preservados
  const pay = await p.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM payments`
  console.log(`[Payments preservados]       ${pay[0].count} rows`)

  // Smoke test trigger
  const sample = await p.$queryRaw<{ id: string }[]>`SELECT id FROM payments LIMIT 1`
  if (sample.length > 0) {
    const before = await p.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM payment_history WHERE payment_id = ${sample[0].id}`
    await p.$executeRaw`UPDATE payments SET description = description WHERE id = ${sample[0].id}`
    const after = await p.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM payment_history WHERE payment_id = ${sample[0].id}`
    const delta = Number(after[0].count) - Number(before[0].count)
    console.log(`[Smoke audit trigger]        +${delta} history row ${delta === 1 ? 'OK' : 'FAIL'}`)
  }

  // fiscal_period via trigger (M-008 mudança)
  const fp = await p.$queryRaw<{ is_generated: string }[]>`
    SELECT is_generated FROM information_schema.columns
     WHERE table_name='fiscal_entries' AND column_name='fiscal_period'`
  console.log(`[fiscal_period type]         ${fp[0]?.is_generated || 'MISSING'} (esperado: NEVER — usa trigger)`)

  console.log('='.repeat(72))
}
main().catch(console.error).finally(() => p.$disconnect())
