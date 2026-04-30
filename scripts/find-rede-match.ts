import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // 1. A transacao Rede que sincronizou
  const txns = await prisma.acquirerTransaction.findMany({
    where: { acquirer: 'rede', gross_amount: 79560 },
    orderBy: { transaction_date: 'desc' },
    take: 5,
  })
  console.log('=== Transacoes Rede de R$ 795,60 ===')
  txns.forEach(t => console.log(`  ${t.id} | data=${t.transaction_date.toISOString().split('T')[0]} | terminal=${t.terminal_code} | matched=${t.matched_payment_id ?? 'NAO'}`))

  // 2. Pra cada candidata, mostrar contexto completo
  console.log('\n=== Candidatas a R$ 795,60 (todas) ===')
  const cands = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      so.id, so.os_number,
      so.created_at::date AS data_criacao,
      so.payment_method,
      cu.legal_name AS cliente,
      ms.name AS status,
      so.total_cost,
      so.approved_cost,
      ar.status AS ar_status,
      ar.total_amount AS ar_valor,
      ar.received_amount AS ar_recebido
    FROM service_orders so
    JOIN customers cu ON cu.id = so.customer_id
    JOIN module_statuses ms ON ms.id = so.status_id
    LEFT JOIN accounts_receivable ar ON ar.service_order_id = so.id AND ar.deleted_at IS NULL
    WHERE so.deleted_at IS NULL
      AND so.total_cost = 79560
    ORDER BY so.created_at DESC
  `)
  cands.forEach(r => console.log(`  OS-${r.os_number} | ${r.data_criacao} | ${r.cliente} | status="${r.status}" | pay=${r.payment_method ?? '?'} | AR=${r.ar_status ?? 'sem AR'}`))

  // 3. Por terminal SD051406 — quem usa (assignment)?
  console.log('\n=== Maquininha SD051406 (atribuicao) ===')
  const ass = await prisma.acquirerTerminalAssignment.findMany({
    where: { terminal_code: 'SD051406' },
    include: { user_profiles: { select: { name: true } } },
  })
  if (ass.length === 0) {
    console.log('  NENHUMA atribuicao em /maquininha/configurar — match score reduzido!')
  } else {
    ass.forEach(a => console.log(`  ${a.assignment_type} | user=${a.user_profiles?.name ?? 'STORE'} | from=${a.valid_from?.toISOString().split('T')[0]} | to=${a.valid_to?.toISOString().split('T')[0] ?? 'aberto'}`))
  }

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
