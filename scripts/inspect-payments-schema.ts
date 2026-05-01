/**
 * Inspeciona schema atual da tabela `payments` em produção.
 * Compara com a spec v2 pra identificar:
 *   - Colunas que JÁ EXISTEM (não duplicar em M-002)
 *   - Colunas que FALTAM (adicionar em M-002 com ALTER TABLE)
 *   - Constraints e índices existentes
 *
 * One-shot. Pode apagar depois.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: 'YES' | 'NO'
  column_default: string | null
}

interface IndexInfo {
  indexname: string
  indexdef: string
}

interface ConstraintInfo {
  conname: string
  contype: string
  pg_get_constraintdef: string
}

async function main() {
  console.log('='.repeat(70))
  console.log('Inspect: tabela payments em produção')
  console.log('='.repeat(70))

  const columns = await prisma.$queryRaw<ColumnInfo[]>`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='payments'
     ORDER BY ordinal_position
  `
  console.log(`\n[COLUMNS] ${columns.length} colunas existentes:`)
  for (const c of columns) {
    const nullStr = c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'
    const defStr = c.column_default ? `DEFAULT ${c.column_default}` : ''
    console.log(`  ${c.column_name.padEnd(28)} ${c.data_type.padEnd(28)} ${nullStr.padEnd(9)} ${defStr}`)
  }

  const indexes = await prisma.$queryRaw<IndexInfo[]>`
    SELECT indexname, indexdef
      FROM pg_indexes
     WHERE schemaname='public' AND tablename='payments'
     ORDER BY indexname
  `
  console.log(`\n[INDEXES] ${indexes.length} índices existentes:`)
  for (const i of indexes) {
    console.log(`  ${i.indexname}`)
    console.log(`    ${i.indexdef}`)
  }

  const constraints = await prisma.$queryRaw<ConstraintInfo[]>`
    SELECT conname, contype::text, pg_get_constraintdef(oid)
      FROM pg_constraint
     WHERE conrelid = 'public.payments'::regclass
     ORDER BY contype, conname
  `
  console.log(`\n[CONSTRAINTS] ${constraints.length}:`)
  for (const ct of constraints) {
    const typeMap: Record<string, string> = {
      p: 'PRIMARY KEY', f: 'FOREIGN KEY', u: 'UNIQUE', c: 'CHECK', x: 'EXCLUSION',
    }
    const typeName = typeMap[ct.contype] ?? ct.contype
    console.log(`  ${typeName.padEnd(13)} ${ct.conname}`)
    console.log(`    ${ct.pg_get_constraintdef}`)
  }

  // RLS check
  const rls = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT relname, relrowsecurity FROM pg_class WHERE relname='payments'
  `
  console.log(`\n[RLS] payments.relrowsecurity = ${rls[0]?.relrowsecurity ?? '???'}`)

  console.log('='.repeat(70))
}

main().catch(console.error).finally(() => prisma.$disconnect())
