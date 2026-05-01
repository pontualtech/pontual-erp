/**
 * Dump lógico das tabelas financeiras pré-M-002.
 *
 * Funciona como restore point Nível 2 (em vez de pg_dump nativo, que não está
 * instalado). Exporta cada tabela pra JSON separado em /tmp com timestamp.
 *
 * Restauração manual: ler JSON e fazer `prisma.<model>.createMany({ data })`.
 *
 * Uso: npx tsx scripts/dump-financeiro-pre-m002.ts
 */

import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient()

// 12 modelos financeiros identificados via grep no schema.prisma.
// Ordem importa pra hipotética restauração: pais primeiro, filhos depois.
const TABLES_TO_DUMP = [
  'account',
  'accountPayable',
  'accountReceivable',
  'asaasCustomer',
  'fiscalConfig',
  'fiscalLog',
  'invoice',
  'invoiceItem',
  'payment',
  'paymentConfig',
  'webhook',
  'webhookLog',
] as const

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT_DIR = join('/tmp', `financeiro-dump-${STAMP}`)

async function dumpTable(modelName: string): Promise<{ table: string; rows: number; sizeKb: number }> {
  // @ts-expect-error — acesso dinâmico pelo nome do model
  const data = await prisma[modelName].findMany()
  const json = JSON.stringify(data, jsonReplacer, 2)
  const path = join(OUT_DIR, `${modelName}.json`)
  writeFileSync(path, json, 'utf-8')
  return {
    table: modelName,
    rows: data.length,
    sizeKb: Math.round(Buffer.byteLength(json, 'utf-8') / 1024),
  }
}

// Serializa BigInt e Date com segurança no JSON.
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  return value
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log('='.repeat(60))
  console.log(`Dump lógico financeiro pré-M-002`)
  console.log(`Destino: ${OUT_DIR}`)
  console.log('='.repeat(60))

  const results: Awaited<ReturnType<typeof dumpTable>>[] = []
  for (const table of TABLES_TO_DUMP) {
    try {
      const result = await dumpTable(table)
      results.push(result)
      console.log(`  OK ${table.padEnd(22)} ${String(result.rows).padStart(6)} rows  (${result.sizeKb} KB)`)
    } catch (err) {
      console.log(`  FAIL ${table}: ${(err as Error).message}`)
    }
  }

  const totalRows = results.reduce((acc, r) => acc + r.rows, 0)
  const totalKb = results.reduce((acc, r) => acc + r.sizeKb, 0)

  // Manifest .json: meta dump pra facilitar restauração
  writeFileSync(
    join(OUT_DIR, '_manifest.json'),
    JSON.stringify(
      { stamp: STAMP, total_rows: totalRows, total_kb: totalKb, tables: results },
      null,
      2,
    ),
  )

  console.log('='.repeat(60))
  console.log(`Total: ${totalRows} rows, ${totalKb} KB em ${results.length} arquivos.`)
  console.log(`Manifest em: ${join(OUT_DIR, '_manifest.json')}`)
  console.log('='.repeat(60))
}

main()
  .catch((err) => {
    console.error('Erro durante dump:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
