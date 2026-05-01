import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Estatistica de OSes com valor real (em qualquer campo)
  const stats = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      COUNT(*)::bigint AS total_oses,
      COUNT(*) FILTER (WHERE COALESCE(total_cost, 0) > 0)::bigint AS com_total_cost,
      COUNT(*) FILTER (WHERE COALESCE(approved_cost, 0) > 0)::bigint AS com_approved_cost,
      COUNT(*) FILTER (WHERE COALESCE(estimated_cost, 0) > 0)::bigint AS com_estimated_cost,
      COUNT(*) FILTER (WHERE COALESCE(total_parts, 0) > 0)::bigint AS com_total_parts,
      COUNT(*) FILTER (WHERE COALESCE(total_services, 0) > 0)::bigint AS com_total_services
    FROM service_orders
    WHERE deleted_at IS NULL
  `)
  console.log('=== Distribuicao geral ServiceOrder (dia 29/04) ===')
  console.log(stats[0])

  // OSes que tem AR com valor — valor real cobrado
  const arStats = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      so.os_number,
      so.total_cost AS so_total_cost,
      so.approved_cost AS so_approved_cost,
      ar.total_amount AS ar_total,
      ar.status AS ar_status,
      so.created_at::date AS data,
      cu.legal_name AS cliente
    FROM service_orders so
    JOIN accounts_receivable ar ON ar.service_order_id = so.id AND ar.deleted_at IS NULL
    JOIN customers cu ON cu.id = so.customer_id
    WHERE so.deleted_at IS NULL
      AND ar.total_amount = 79560
    ORDER BY so.created_at DESC
    LIMIT 10
  `)
  console.log('\n=== OSes com AR de R$ 795,60 (matching valor da venda Rede) ===')
  if (arStats.length === 0) {
    console.log('  NENHUMA encontrada.')
  } else {
    arStats.forEach(r => console.log(`  OS-${r.os_number} | ${r.cliente} | ${r.data} | so.total_cost=${r.so_total_cost} | ar.total=${r.ar_total} | ${r.ar_status}`))
  }

  // Outras OSes com total_cost de R$ 795,60 (mesmo sem AR)
  const direct = await prisma.$queryRawUnsafe<any[]>(`
    SELECT so.os_number, so.total_cost, so.approved_cost, so.created_at::date AS data, cu.legal_name AS cliente
    FROM service_orders so
    JOIN customers cu ON cu.id = so.customer_id
    WHERE so.deleted_at IS NULL
      AND so.total_cost = 79560
    ORDER BY so.created_at DESC
    LIMIT 10
  `)
  console.log('\n=== OSes com total_cost = R$ 795,60 ===')
  if (direct.length === 0) {
    console.log('  NENHUMA encontrada.')
  } else {
    direct.forEach(r => console.log(`  OS-${r.os_number} | ${r.cliente} | ${r.data} | total_cost=${r.total_cost}`))
  }

  // E OSes do dia 28/04 (data da venda) com qualquer valor
  const sameDay = await prisma.$queryRawUnsafe<any[]>(`
    SELECT so.os_number, so.total_cost, so.approved_cost, cu.legal_name AS cliente
    FROM service_orders so
    JOIN customers cu ON cu.id = so.customer_id
    WHERE so.deleted_at IS NULL
      AND so.created_at::date = '2026-04-28'
    ORDER BY so.created_at DESC
    LIMIT 20
  `)
  console.log('\n=== OSes criadas em 2026-04-28 (dia da venda Rede) ===')
  console.log(`  Total: ${sameDay.length}`)
  sameDay.forEach(r => console.log(`  OS-${r.os_number} | ${r.cliente} | total_cost=${r.total_cost}`))

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
