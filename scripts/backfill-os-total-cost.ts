/**
 * Backfill 2026-04-29: OSes com Quote APROVADO mas total_cost=0
 *
 * Estrategia cirurgica:
 *   1. Cria tabela _backup_service_orders_2026_04_29 (so as linhas
 *      candidatas a serem atualizadas — instantaneo, reversivel)
 *   2. Roda preview (COUNT + SUM)
 *   3. Pede confirmacao manual no console se forem > 500 linhas
 *   4. Executa UPDATE com CTE pegando o Quote APROVADO mais recente
 *   5. Verificacao pos-backfill (deve dar 0 linhas pendentes)
 *
 * Rollback:
 *   UPDATE service_orders so
 *   SET total_cost=b.total_cost, approved_cost=b.approved_cost
 *   FROM _backup_service_orders_2026_04_29 b
 *   WHERE so.id = b.id;
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SAFE_THRESHOLD = 500
const AUTO_CONFIRM = process.argv.includes('--yes')

async function main() {
  console.log('=== Backfill OS total_cost from Quote APPROVED ===\n')

  // Passo 1: snapshot das linhas que serao tocadas
  console.log('Step 1: criando snapshot _backup_service_orders_2026_04_29...')
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _backup_service_orders_2026_04_29`)
  const snapshotCount = await prisma.$executeRawUnsafe(`
    CREATE TABLE _backup_service_orders_2026_04_29 AS
    SELECT so.id, so.os_number, so.total_cost, so.approved_cost, so.updated_at
    FROM service_orders so
    JOIN quotes q ON q.service_order_id = so.id
    WHERE so.deleted_at IS NULL
      AND q.status = 'APPROVED'
      AND q.total_amount > 0
      AND COALESCE(so.total_cost, 0) = 0
  `)
  console.log(`  Snapshot criado: ${snapshotCount} linhas backupadas\n`)

  // Passo 2: preview detalhado
  console.log('Step 2: preview...')
  const preview = await prisma.$queryRawUnsafe<{ total: bigint, soma: bigint | null }[]>(`
    SELECT
      COUNT(*)::bigint AS total,
      SUM(q.total_amount)::bigint AS soma
    FROM service_orders so
    JOIN quotes q ON q.service_order_id = so.id
    WHERE so.deleted_at IS NULL
      AND q.status = 'APPROVED'
      AND q.total_amount > 0
      AND COALESCE(so.total_cost, 0) = 0
  `)
  const total = Number(preview[0]?.total ?? 0n)
  const somaCents = Number(preview[0]?.soma ?? 0n)
  const somaR = (somaCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  console.log(`  OSes a corrigir: ${total}`)
  console.log(`  Soma total a propagar: ${somaR}\n`)

  if (total === 0) {
    console.log('Nada a fazer. Saindo.')
    await prisma.$disconnect()
    return
  }

  if (total > SAFE_THRESHOLD && !AUTO_CONFIRM) {
    console.log(`PAUSADO: ${total} > ${SAFE_THRESHOLD}. Re-rodar com --yes pra prosseguir.`)
    await prisma.$disconnect()
    process.exit(2)
  }

  // Passo 3: UPDATE
  console.log('Step 3: executando UPDATE...')
  const updated = await prisma.$executeRawUnsafe(`
    WITH latest_approved AS (
      SELECT DISTINCT ON (q.service_order_id)
        q.service_order_id,
        q.total_amount,
        q.approved_at
      FROM quotes q
      WHERE q.status = 'APPROVED'
        AND q.total_amount > 0
      ORDER BY q.service_order_id, q.approved_at DESC NULLS LAST
    )
    UPDATE service_orders so
    SET
      total_cost    = la.total_amount,
      approved_cost = la.total_amount,
      updated_at    = NOW()
    FROM latest_approved la
    WHERE so.id = la.service_order_id
      AND so.deleted_at IS NULL
      AND COALESCE(so.total_cost, 0) = 0
  `)
  console.log(`  UPDATE executado: ${updated} linhas afetadas\n`)

  // Passo 4: verificacao
  console.log('Step 4: verificando...')
  const post = await prisma.$queryRawUnsafe<{ pending: bigint }[]>(`
    SELECT COUNT(*)::bigint AS pending
    FROM service_orders so
    JOIN quotes q ON q.service_order_id = so.id
    WHERE so.deleted_at IS NULL
      AND q.status = 'APPROVED'
      AND q.total_amount > 0
      AND COALESCE(so.total_cost, 0) = 0
  `)
  const pending = Number(post[0]?.pending ?? 0n)
  console.log(`  OSes ainda zeradas com Quote aprovado: ${pending}\n`)

  if (pending === 0) {
    console.log('OK — backfill completo.')
  } else {
    console.log(`AVISO: ${pending} OSes ficaram pendentes (race condition? deletadas? checar manualmente).`)
  }

  console.log('\nRollback se precisar:')
  console.log(`  UPDATE service_orders so SET total_cost=b.total_cost, approved_cost=b.approved_cost`)
  console.log(`    FROM _backup_service_orders_2026_04_29 b WHERE so.id=b.id;`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('ERRO:', e)
  await prisma.$disconnect()
  process.exit(1)
})
