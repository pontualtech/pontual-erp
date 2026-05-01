import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Pega últimas OSes (60302-60305) pra inspecionar
  const oses = await prisma.serviceOrder.findMany({
    where: {
      os_number: { in: [60302, 60303, 60304, 60305] },
      deleted_at: null,
    },
    select: {
      id: true,
      os_number: true,
      total_cost: true,
      approved_cost: true,
      total_parts: true,
      total_services: true,
      created_at: true,
      customer_id: true,
      customers: { select: { legal_name: true } },
      service_order_items: { where: { deleted_at: null }, select: { description: true, total_price: true } },
      quotes: { select: { quote_number: true, status: true, total_amount: true, approved_at: true } },
      accounts_receivable: { where: { deleted_at: null }, select: { id: true, status: true, total_amount: true, received_amount: true } },
    },
  })

  for (const os of oses) {
    console.log(`\n=== OS-${String(os.os_number).padStart(4, '0')} ${os.customers?.legal_name || '?'} ===`)
    console.log(`  total_cost:         ${os.total_cost ?? 'null'} centavos`)
    console.log(`  approved_cost:      ${os.approved_cost ?? 'null'}`)
    console.log(`  total_parts:        ${os.total_parts ?? 'null'}`)
    console.log(`  total_services:     ${os.total_services ?? 'null'}`)
    console.log(`  created_at:         ${os.created_at?.toISOString()}`)
    console.log(`  itens:              ${os.service_order_items.length}`)
    for (const item of os.service_order_items) {
      console.log(`    - ${item.description?.slice(0, 50)}: ${item.total_price} centavos`)
    }
    console.log(`  quotes:             ${os.quotes.length}`)
    for (const q of os.quotes) {
      console.log(`    - ${q.quote_number}: ${q.status} | total_amount=${q.total_amount} | aprovado_em=${q.approved_at?.toISOString() || 'never'}`)
    }
    console.log(`  contas a receber:   ${os.accounts_receivable.length}`)
    for (const ar of os.accounts_receivable) {
      console.log(`    - status=${ar.status} | total=${ar.total_amount} | recebido=${ar.received_amount}`)
    }
  }

  // Tambem: contagem geral de OSes com total_cost=0
  const stats = await prisma.$queryRawUnsafe<{ total: bigint, com_quote: bigint, com_quote_approved: bigint, com_items: bigint, com_ar: bigint }[]>(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(DISTINCT q.service_order_id) FILTER (WHERE q.id IS NOT NULL)::bigint AS com_quote,
      COUNT(DISTINCT q.service_order_id) FILTER (WHERE q.status = 'APPROVED')::bigint AS com_quote_approved,
      COUNT(DISTINCT i.service_order_id) FILTER (WHERE i.id IS NOT NULL AND i.total_price > 0)::bigint AS com_items,
      COUNT(DISTINCT ar.service_order_id) FILTER (WHERE ar.id IS NOT NULL)::bigint AS com_ar
    FROM service_orders so
    LEFT JOIN quotes q ON q.service_order_id = so.id
    LEFT JOIN service_order_items i ON i.service_order_id = so.id AND i.deleted_at IS NULL
    LEFT JOIN accounts_receivable ar ON ar.service_order_id = so.id AND ar.deleted_at IS NULL
    WHERE so.deleted_at IS NULL
      AND COALESCE(so.total_cost, 0) = 0
  `)
  const r = stats[0]
  console.log(`\n=== Estatistica de OSes com total_cost = 0 (todas, qualquer status) ===`)
  console.log(`  total OSes zeradas:                   ${r?.total}`)
  console.log(`  destas, com algum Quote:              ${r?.com_quote}`)
  console.log(`  destas, com Quote APROVADO:           ${r?.com_quote_approved}`)
  console.log(`  destas, com items (total_price>0):    ${r?.com_items}`)
  console.log(`  destas, com AR:                       ${r?.com_ar}`)

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
