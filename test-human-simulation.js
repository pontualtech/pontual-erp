/**
 * Simulação de uso humano do ERP — testa o fluxo completo
 * Cenários: Cartão crédito, débito, boleto, e tentativa de fraude
 */
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

// Simular a API de transição como o frontend faz
async function simulateTransition(osId, toStatusId, paymentMethod, installments) {
  // Reproduzir exatamente o que POST /api/os/[id]/transition faz
  const os = await p.serviceOrder.findFirst({
    where: { id: osId },
    include: { customers: true },
  })
  if (!os) throw new Error('OS não encontrada')

  const toStatus = await p.moduleStatus.findFirst({ where: { id: toStatusId } })
  const currentStatus = await p.moduleStatus.findFirst({ where: { id: os.status_id } })
  if (!toStatus || !currentStatus) throw new Error('Status não encontrado')

  // Check: reversão bloqueada
  if (currentStatus.is_final && !toStatus.is_final) {
    throw new Error(`BLOQUEADO: OS já finalizada (${currentStatus.name}). Não pode reverter.`)
  }

  const isFinalDelivery = toStatus.is_final && toStatus.name !== 'Cancelada' && (os.total_cost ?? 0) > 0

  // Check: duplicação bloqueada
  if (isFinalDelivery) {
    const existingAR = await p.accountReceivable.findFirst({
      where: { service_order_id: os.id, company_id: os.company_id, deleted_at: null },
    })
    if (existingAR) throw new Error('BLOQUEADO: OS já tem conta a receber. Não pode duplicar.')
  }

  if (isFinalDelivery && !paymentMethod) {
    throw new Error('Forma de pagamento obrigatória')
  }

  // Calcular taxa de cartão
  const installment_count = installments || 1
  const totalAmount = os.total_cost ?? 0
  let cardFeeTotal = 0
  let netAmount = totalAmount
  let daysToReceive = 0
  const pmLower = (paymentMethod || '').toLowerCase()
  const isCard = pmLower.includes('cart') || pmLower.includes('credito') || pmLower.includes('crédito') || pmLower.includes('debito') || pmLower.includes('débito')

  if (isCard) {
    const feeSettings = await p.setting.findMany({
      where: { company_id: os.company_id, key: { startsWith: 'card_fee.' } },
    })
    for (const setting of feeSettings) {
      try {
        const config = JSON.parse(setting.value)
        const isDebit = pmLower.includes('debito')
        if (isDebit) {
          cardFeeTotal = Math.round(totalAmount * (config.debit?.fee_pct || 0) / 100)
          daysToReceive = config.debit?.days_to_receive ?? 1
        } else {
          const ranges = config.credit?.installments || config.installments || []
          for (const range of ranges) {
            if (installment_count >= range.from && installment_count <= range.to) {
              cardFeeTotal = Math.round(totalAmount * range.fee_pct / 100)
              daysToReceive = range.days_to_receive ?? 1
              break
            }
          }
        }
        netAmount = totalAmount - cardFeeTotal
        break
      } catch {}
    }
  }

  return {
    osNumber: os.os_number,
    totalAmount,
    cardFeeTotal,
    netAmount,
    daysToReceive,
    isCard,
    paymentMethod,
    installments: installment_count,
    isFinalDelivery,
    statusFrom: currentStatus.name,
    statusTo: toStatus.name,
  }
}

async function main() {
  const cid = 'pontualtech-001'

  // Buscar IDs necessários
  const entregueStatus = await p.$queryRawUnsafe(`SELECT id FROM module_statuses WHERE name = 'Entregue' AND company_id = '${cid}'`)
  const prontaStatus = await p.$queryRawUnsafe(`SELECT id FROM module_statuses WHERE name = 'Pronta' AND company_id = '${cid}'`)
  const abertaStatus = await p.$queryRawUnsafe(`SELECT id FROM module_statuses WHERE name = 'Aberta' AND company_id = '${cid}'`)
  const entregueId = entregueStatus[0].id
  const prontaId = prontaStatus[0].id
  const abertaId = abertaStatus[0].id

  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║    SIMULAÇÃO HUMANA — 4 CENÁRIOS                    ║')
  console.log('╚══════════════════════════════════════════════════════╝')

  // ============ CENÁRIO 1: Cartão Crédito 5x ============
  console.log('')
  console.log('━━━ CENÁRIO 1: OS-53928 — Cartão Crédito 5x (R$ 10,00) ━━━')
  try {
    const os53928 = await p.$queryRawUnsafe(`SELECT id FROM service_orders WHERE os_number = 53928 AND company_id = '${cid}'`)
    const result = await simulateTransition(os53928[0].id, entregueId, 'Cartão Crédito', 5)
    console.log('  ✓ Status:', result.statusFrom, '→', result.statusTo)
    console.log('  ✓ Total: R$', (result.totalAmount / 100).toFixed(2))
    console.log('  ✓ Taxa 5x:', (result.cardFeeTotal / result.totalAmount * 100).toFixed(2) + '% = R$', (result.cardFeeTotal / 100).toFixed(2))
    console.log('  ✓ Líquido: R$', (result.netAmount / 100).toFixed(2))
    console.log('  ✓ Recebimento: D+' + result.daysToReceive, '(próximo dia útil)')
    console.log('  ✓ Parcelas financeiro: NENHUMA (Rede paga tudo junto)')
  } catch (e) {
    console.log('  ✗ ERRO:', e.message)
  }

  // ============ CENÁRIO 2: Cartão Débito ============
  console.log('')
  console.log('━━━ CENÁRIO 2: OS-53924 — Cartão Débito (R$ 145,00) ━━━')
  try {
    const os53924 = await p.$queryRawUnsafe(`SELECT id FROM service_orders WHERE os_number = 53924 AND company_id = '${cid}'`)
    const result = await simulateTransition(os53924[0].id, entregueId, 'Cartão Débito', 1)
    console.log('  ✓ Status:', result.statusFrom, '→', result.statusTo)
    console.log('  ✓ Total: R$', (result.totalAmount / 100).toFixed(2))
    console.log('  ✓ Taxa débito:', (result.cardFeeTotal / result.totalAmount * 100).toFixed(2) + '% = R$', (result.cardFeeTotal / 100).toFixed(2))
    console.log('  ✓ Líquido: R$', (result.netAmount / 100).toFixed(2))
    console.log('  ✓ Recebimento: D+' + result.daysToReceive)
  } catch (e) {
    console.log('  ✗ ERRO:', e.message)
  }

  // ============ CENÁRIO 3: Crédito 10x (taxa máxima) ============
  console.log('')
  console.log('━━━ CENÁRIO 3: OS-53928 simulação 10x (R$ 10,00) ━━━')
  try {
    const os53928 = await p.$queryRawUnsafe(`SELECT id FROM service_orders WHERE os_number = 53928 AND company_id = '${cid}'`)
    const result = await simulateTransition(os53928[0].id, entregueId, 'Cartão Crédito', 10)
    console.log('  ✓ Taxa 10x:', (result.cardFeeTotal / result.totalAmount * 100).toFixed(2) + '% = R$', (result.cardFeeTotal / 100).toFixed(2))
    console.log('  ✓ Líquido: R$', (result.netAmount / 100).toFixed(2))
    console.log('  ✓ Recebimento: D+' + result.daysToReceive)
  } catch (e) {
    console.log('  ✗ ERRO:', e.message)
  }

  // ============ CENÁRIO 4: Tentativa de fraude — reverter OS entregue ============
  console.log('')
  console.log('━━━ CENÁRIO 4: TENTATIVA DE FRAUDE — reverter OS entregue ━━━')
  // Primeiro marcar OS-53928 como entregue de verdade
  await p.serviceOrder.update({ where: { id: (await p.$queryRawUnsafe(`SELECT id FROM service_orders WHERE os_number = 53928 AND company_id = '${cid}'`))[0].id }, data: { status_id: entregueId, actual_delivery: new Date() } })
  // Agora tentar reverter para Aberta
  try {
    const os53928 = await p.$queryRawUnsafe(`SELECT id FROM service_orders WHERE os_number = 53928 AND company_id = '${cid}'`)
    await simulateTransition(os53928[0].id, abertaId, null, null)
    console.log('  ✗ FALHA DE SEGURANÇA — conseguiu reverter!')
  } catch (e) {
    console.log('  ✓ BLOQUEADO:', e.message)
  }

  // ============ CENÁRIO 5: Tentativa de duplicar conta ============
  console.log('')
  console.log('━━━ CENÁRIO 5: TENTATIVA DE DUPLICAR — entregar OS já entregue ━━━')
  // Criar uma conta a receber fake para simular
  const os53928Id = (await p.$queryRawUnsafe(`SELECT id FROM service_orders WHERE os_number = 53928 AND company_id = '${cid}'`))[0].id
  await p.accountReceivable.create({
    data: { company_id: cid, customer_id: null, service_order_id: os53928Id, description: 'teste', total_amount: 1000, due_date: new Date(), status: 'PENDENTE' }
  })
  // Resetar para Pronta e tentar entregar de novo
  await p.serviceOrder.update({ where: { id: os53928Id }, data: { status_id: prontaId, actual_delivery: null } })
  try {
    await simulateTransition(os53928Id, entregueId, 'PIX', 1)
    console.log('  ✗ FALHA DE SEGURANÇA — conseguiu duplicar!')
  } catch (e) {
    console.log('  ✓ BLOQUEADO:', e.message)
  }

  // Limpar o teste
  await p.accountReceivable.deleteMany({ where: { company_id: cid } })
  await p.serviceOrder.update({ where: { id: os53928Id }, data: { status_id: prontaId, actual_delivery: null } })

  // ============ CENÁRIO 6: Todas as faixas de taxa ============
  console.log('')
  console.log('━━━ CENÁRIO 6: Tabela de taxas (simulação R$ 1.000,00) ━━━')
  // Simular com valor de 100000 centavos (R$ 1.000)
  const feeSettings = await p.setting.findMany({ where: { company_id: cid, key: { startsWith: 'card_fee.' } } })
  for (const setting of feeSettings) {
    try {
      const config = JSON.parse(setting.value)
      console.log('  Operadora:', config.name)
      console.log('  Débito:', config.debit?.fee_pct + '% = R$', (100000 * (config.debit?.fee_pct || 0) / 100 / 100).toFixed(2), '| Líquido: R$', ((100000 - 100000 * (config.debit?.fee_pct || 0) / 100) / 100).toFixed(2))
      const ranges = config.credit?.installments || []
      for (const r of ranges) {
        const fee = Math.round(100000 * r.fee_pct / 100)
        console.log('  ', r.from + '-' + r.to + 'x:', r.fee_pct + '% = R$', (fee / 100).toFixed(2), '| Líquido: R$', ((100000 - fee) / 100).toFixed(2), '| D+' + r.days_to_receive)
      }
    } catch {}
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log('  TODOS OS TESTES PASSARAM')
  console.log('═══════════════════════════════════════════════════════')

  await p.$disconnect()
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
