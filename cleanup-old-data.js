const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const cutoff = new Date('2026-04-01T00:00:00.000Z')
  const companyId = 'pontualtech-001'

  console.log('=== LIMPEZA: Inativar registros anteriores a 01/04/2026 ===')
  console.log('')

  // 1. Contas a Receber — marcar como cancelado ou soft-delete
  const arOld = await p.accountReceivable.findMany({
    where: {
      company_id: companyId,
      created_at: { lt: cutoff },
      deleted_at: null,
    },
    select: { id: true, description: true, status: true, total_amount: true, created_at: true },
  })
  console.log('Contas a Receber antigas:', arOld.length)
  for (const ar of arOld) {
    console.log('  -', ar.description?.substring(0, 50), '| R$', (ar.total_amount / 100).toFixed(2), '| Status:', ar.status)
  }

  if (arOld.length > 0) {
    const result = await p.accountReceivable.updateMany({
      where: {
        company_id: companyId,
        created_at: { lt: cutoff },
        deleted_at: null,
      },
      data: { deleted_at: new Date() },
    })
    console.log('  >> Soft-deleted:', result.count, 'contas a receber')
  }

  // 2. Contas a Pagar
  const apOld = await p.accountPayable.findMany({
    where: {
      company_id: companyId,
      created_at: { lt: cutoff },
      deleted_at: null,
    },
    select: { id: true, description: true, status: true, total_amount: true, created_at: true },
  })
  console.log('')
  console.log('Contas a Pagar antigas:', apOld.length)
  for (const ap of apOld) {
    console.log('  -', ap.description?.substring(0, 50), '| R$', (ap.total_amount / 100).toFixed(2), '| Status:', ap.status)
  }

  if (apOld.length > 0) {
    const result = await p.accountPayable.updateMany({
      where: {
        company_id: companyId,
        created_at: { lt: cutoff },
        deleted_at: null,
      },
      data: { deleted_at: new Date() },
    })
    console.log('  >> Soft-deleted:', result.count, 'contas a pagar')
  }

  // 3. Transactions antigas
  const txOld = await p.transaction.findMany({
    where: {
      company_id: companyId,
      transaction_date: { lt: cutoff },
    },
    select: { id: true, description: true, amount: true, transaction_type: true, transaction_date: true },
  })
  console.log('')
  console.log('Transacoes antigas:', txOld.length)
  for (const tx of txOld) {
    console.log('  -', tx.transaction_type, '| R$', (tx.amount / 100).toFixed(2), '|', tx.description?.substring(0, 40))
  }

  if (txOld.length > 0) {
    const result = await p.transaction.deleteMany({
      where: {
        company_id: companyId,
        transaction_date: { lt: cutoff },
      },
    })
    console.log('  >> Deletadas:', result.count, 'transacoes')
  }

  // 4. Parcelas (installments) de contas removidas
  const deletedARIds = arOld.map(a => a.id)
  if (deletedARIds.length > 0) {
    const instResult = await p.installment.deleteMany({
      where: {
        company_id: companyId,
        parent_id: { in: deletedARIds },
      },
    })
    console.log('')
    console.log('Parcelas removidas:', instResult.count)
  }

  // Resumo
  console.log('')
  console.log('=== RESUMO ===')

  const arAtivos = await p.accountReceivable.count({ where: { company_id: companyId, deleted_at: null } })
  const apAtivos = await p.accountPayable.count({ where: { company_id: companyId, deleted_at: null } })
  const txAtivos = await p.transaction.count({ where: { company_id: companyId } })

  console.log('Contas a Receber ativas:', arAtivos)
  console.log('Contas a Pagar ativas:', apAtivos)
  console.log('Transacoes ativas:', txAtivos)
  console.log('')
  console.log('Pronto! Sistema limpo a partir de 01/04/2026.')

  await p.$disconnect()
}
main().catch(e => { console.error(e.message); process.exit(1) })
