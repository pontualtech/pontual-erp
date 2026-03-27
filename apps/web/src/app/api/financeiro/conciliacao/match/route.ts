import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// POST /api/financeiro/conciliacao/match
// Confirm reconciliation between a bank transaction and a payable/receivable
// ---------------------------------------------------------------------------

const matchSchema = z.object({
  transaction_id: z.string().min(1, 'transaction_id e obrigatorio'),
  type: z.enum(['payable', 'receivable']),
  record_id: z.string().min(1, 'record_id e obrigatorio'),
})

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = matchSchema.parse(body)

    // Validate transaction exists and belongs to company
    const transaction = await prisma.transaction.findFirst({
      where: {
        id: data.transaction_id,
        company_id: user.companyId,
      },
    })
    if (!transaction) return error('Transacao nao encontrada', 404)
    if (transaction.reconciled) return error('Transacao ja foi conciliada', 400)

    const absAmount = Math.abs(transaction.amount)

    if (data.type === 'payable') {
      // Match with AccountPayable
      const payable = await prisma.accountPayable.findFirst({
        where: {
          id: data.record_id,
          company_id: user.companyId,
          deleted_at: null,
        },
      })
      if (!payable) return error('Conta a pagar nao encontrada', 404)
      if (payable.status === 'PAGO') return error('Conta a pagar ja esta paga', 400)
      if (payable.status === 'CANCELADO') return error('Conta a pagar cancelada', 400)

      const previousPaid = payable.paid_amount || 0
      const newPaidTotal = previousPaid + absAmount
      const isPaidInFull = newPaidTotal >= payable.total_amount

      // Update payable
      await prisma.accountPayable.update({
        where: { id: data.record_id },
        data: {
          paid_amount: newPaidTotal,
          status: isPaidInFull ? 'PAGO' : 'PENDENTE',
          updated_at: new Date(),
        },
      })

      // Mark transaction as reconciled
      await prisma.transaction.update({
        where: { id: data.transaction_id },
        data: { reconciled: true },
      })

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'financeiro',
        action: 'conciliacao.match',
        entityId: data.transaction_id,
        newValue: {
          type: 'payable',
          record_id: data.record_id,
          amount: absAmount,
          payable_description: payable.description,
          new_paid_total: newPaidTotal,
          new_status: isPaidInFull ? 'PAGO' : 'PENDENTE',
        },
      })

      return success({
        transaction_id: data.transaction_id,
        reconciled: true,
        payable_id: data.record_id,
        payable_status: isPaidInFull ? 'PAGO' : 'PENDENTE',
        paid_total: newPaidTotal,
      })
    } else {
      // Match with AccountReceivable
      const receivable = await prisma.accountReceivable.findFirst({
        where: {
          id: data.record_id,
          company_id: user.companyId,
          deleted_at: null,
        },
      })
      if (!receivable) return error('Conta a receber nao encontrada', 404)
      if (receivable.status === 'RECEBIDO') return error('Conta a receber ja foi recebida', 400)
      if (receivable.status === 'CANCELADO') return error('Conta a receber cancelada', 400)

      const previousReceived = receivable.received_amount || 0
      const newReceivedTotal = previousReceived + absAmount
      const isReceivedInFull = newReceivedTotal >= receivable.total_amount

      // Update receivable
      await prisma.accountReceivable.update({
        where: { id: data.record_id },
        data: {
          received_amount: newReceivedTotal,
          status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
          updated_at: new Date(),
        },
      })

      // Mark transaction as reconciled
      await prisma.transaction.update({
        where: { id: data.transaction_id },
        data: { reconciled: true },
      })

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'financeiro',
        action: 'conciliacao.match',
        entityId: data.transaction_id,
        newValue: {
          type: 'receivable',
          record_id: data.record_id,
          amount: absAmount,
          receivable_description: receivable.description,
          new_received_total: newReceivedTotal,
          new_status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
        },
      })

      return success({
        transaction_id: data.transaction_id,
        reconciled: true,
        receivable_id: data.record_id,
        receivable_status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
        received_total: newReceivedTotal,
      })
    }
  } catch (err) {
    return handleError(err)
  }
}
