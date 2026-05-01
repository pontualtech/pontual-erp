import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const p = new PrismaClient()
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = join('/tmp', `pre-m007-${STAMP}`)
const TABLES = ['accounts_receivable', 'accounts_payable', 'payments', 'payment_history',
  'webhook_events_log', 'accounts_chart', 'fiscal_entries', 'cobranca_rules',
  'cobranca_rule_steps', 'payment_reminders', 'feature_flags', 'tenant_feature_flags',
  'payment_method_configs', 'payment_terms', 'reconciliation_batches',
  'reconciliation_entries', 'voip_extensions']

async function main() {
  mkdirSync(OUT, { recursive: true })
  console.log(`Dump → ${OUT}`)
  let total = 0
  for (const t of TABLES) {
    try {
      const rows = await (p as any)[t.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]?.findMany?.()
      if (rows) {
        writeFileSync(join(OUT, `${t}.json`), JSON.stringify(rows, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v, 2))
        console.log(`  ${t.padEnd(28)} ${rows.length} rows`)
        total += rows.length
      } else {
        // Fallback raw SQL
        const data = await p.$queryRawUnsafe(`SELECT * FROM ${t} LIMIT 10000`)
        writeFileSync(join(OUT, `${t}.json`), JSON.stringify(data, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v, 2))
        console.log(`  ${t.padEnd(28)} ${(data as any[]).length} rows (raw)`)
        total += (data as any[]).length
      }
    } catch (e: any) {
      console.log(`  ${t.padEnd(28)} SKIP: ${e.message?.slice(0, 50)}`)
    }
  }
  console.log(`Total: ${total} rows preservados em ${OUT}`)
}
main().catch(console.error).finally(() => p.$disconnect())
