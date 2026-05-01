// Validação M-001 — confirma que os 10 enum types foram criados
// Uso: npx tsx scripts/validate-m001.ts (cwd = root do monorepo)
// Removível depois — script descartável de validação one-shot.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const expected = [
  'payment_kind',
  'payment_status',
  'payment_method_kind',
  'payment_provider',
  'webhook_event_status',
  'reminder_channel',
  'reminder_status',
  'chart_account_type',
  'reconciliation_status',
  'feature_flag_strategy',
] as const

async function main() {
  const rows = await prisma.$queryRaw<Array<{ typname: string; n_values: number }>>`
    SELECT t.typname,
           (SELECT count(*) FROM pg_enum e WHERE e.enumtypid = t.oid)::int AS n_values
      FROM pg_type t
     WHERE t.typname = ANY(${expected as unknown as string[]})
     ORDER BY t.typname
  `

  const found = new Set(rows.map(r => r.typname))
  const missing = expected.filter(name => !found.has(name))

  console.log('='.repeat(60))
  console.log('M-001 Validation Report')
  console.log('='.repeat(60))
  console.log(`Expected: ${expected.length} types`)
  console.log(`Found:    ${rows.length} types`)
  console.log()

  for (const name of expected) {
    const row = rows.find(r => r.typname === name)
    if (row) {
      console.log(`  OK ${name} (${row.n_values} values)`)
    } else {
      console.log(`  MISSING ${name}`)
    }
  }

  console.log('='.repeat(60))
  if (missing.length === 0) {
    console.log('PASS — todos os 10 tipos criados com sucesso.')
  } else {
    console.log(`FAIL — ${missing.length} tipo(s) faltando: ${missing.join(', ')}`)
    process.exitCode = 1
  }
}

main()
  .catch(err => {
    console.error('Erro durante validação:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
