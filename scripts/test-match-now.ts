// Testa match real chamando endpoint do ERP em produção (já com código novo)
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const txn = await prisma.acquirerTransaction.findFirst({
    where: { acquirer: 'rede', gross_amount: 79560, matched_payment_id: null },
    orderBy: { transaction_date: 'desc' },
  })
  if (!txn) {
    console.log('Nenhuma transacao Rede pendente de R$ 795,60')
    await prisma.$disconnect()
    return
  }
  console.log(`=== Transacao alvo ===`)
  console.log(`  id: ${txn.id}`)
  console.log(`  data: ${txn.transaction_date.toISOString().split('T')[0]}`)
  console.log(`  terminal: ${txn.terminal_code}`)
  console.log(`  modality: ${txn.modality}`)
  console.log()

  // Simula a query do match-engine (-30/+1 dias, total_cost exato)
  const startDate = new Date(txn.transaction_date)
  startDate.setDate(startDate.getDate() - 30)
  const endDate = new Date(txn.transaction_date)
  endDate.setDate(endDate.getDate() + 1)

  const cands = await prisma.serviceOrder.findMany({
    where: {
      total_cost: txn.gross_amount,
      created_at: { gte: startDate, lte: endDate },
      deleted_at: null,
    },
    include: {
      customers: { select: { legal_name: true } },
      module_statuses: { select: { name: true } },
    },
  })
  console.log(`=== Candidatas (janela -30/+1 dias, valor exato) ===`)
  console.log(`  Total: ${cands.length}`)
  for (const c of cands) {
    const days = Math.abs(Math.round((txn.transaction_date.getTime() - (c.created_at?.getTime() ?? 0)) / (86400 * 1000)))
    console.log(`  OS-${c.os_number} | ${c.customers?.legal_name} | ${days} dias | status="${c.module_statuses?.name}" | pay=${c.payment_method ?? '?'} | tech=${c.technician_id?.slice(0,8) ?? '?'}`)
  }
  console.log()

  // Verifica assignment do terminal
  const ass = await prisma.acquirerTerminalAssignment.findFirst({
    where: {
      terminal_code: txn.terminal_code!,
      valid_from: { lte: txn.transaction_date },
      OR: [{ valid_to: null }, { valid_to: { gte: txn.transaction_date } }],
    },
  })
  console.log(`=== Assignment SD051406 ===`)
  console.log(`  type: ${ass?.assignment_type ?? 'NENHUM'}`)
  console.log(`  user_id: ${ass?.user_id ?? '?'}`)
  console.log()

  // Simular score pra cada candidata
  console.log(`=== Score esperado por candidata ===`)
  for (const c of cands) {
    let score = 40 // valor exato
    const reasons: string[] = ['valor +40']
    const days = Math.abs(Math.round((txn.transaction_date.getTime() - (c.created_at?.getTime() ?? 0)) / (86400 * 1000)))
    if (days === 0) { score += 25; reasons.push('mesmo dia +25') }
    else if (days <= 1) { score += 22; reasons.push('±1d +22') }
    else if (days <= 3) { score += 18; reasons.push(`±${days}d +18`) }
    else if (days <= 7) { score += 14; reasons.push(`±${days}d +14`) }
    else if (days <= 15) { score += 10; reasons.push(`±${days}d +10`) }
    else if (days <= 30) { score += 6; reasons.push(`±${days}d +6`) }

    if (ass?.assignment_type === 'DRIVER' && c.technician_id === ass.user_id) {
      score += 25; reasons.push('motorista direto +25')
    } else if (ass?.assignment_type === 'STORE' && c.os_location === 'LOJA') {
      score += 25; reasons.push('loja +25')
    } else if (!ass) {
      score += 12; reasons.push('sem assignment +12')
    } else {
      // Pode ainda ter via logistics_stop — checa
      const hasStop = await prisma.logisticsStop.count({
        where: { os_id: c.id, route: { driver_id: ass.user_id! } },
      })
      if (hasStop > 0) { score += 25; reasons.push('motorista via stop +25') }
      else { reasons.push('motorista divergente +0') }
    }

    if (c.payment_method) {
      const pm = c.payment_method.toLowerCase()
      if (txn.modality === 'credit' && /cart|credit|cred/.test(pm)) {
        score += 10; reasons.push('forma credito +10')
      } else if (txn.modality === 'debit' && /debit|deb/.test(pm)) {
        score += 10; reasons.push('forma debito +10')
      } else { reasons.push(`forma divergente (${pm}) +0`) }
    } else {
      score += 5; reasons.push('sem forma +5')
    }

    console.log(`  OS-${c.os_number}: ${score}  (${reasons.join(' | ')})`)
  }

  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
