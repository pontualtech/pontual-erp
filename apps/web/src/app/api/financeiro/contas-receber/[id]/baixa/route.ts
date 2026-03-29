import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { baixaSchema } from '@/lib/validations/financeiro'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a receber nao encontrada', 404)
    if (existing.status === 'RECEBIDO') return error('Conta ja foi recebida', 400)
    if (existing.status === 'CANCELADO') return error('Conta cancelada nao pode ser recebida', 400)

    const body = await req.json()
    const data = baixaSchema.parse(body)

    const previousReceived = existing.received_amount || 0
    const newReceivedTotal = previousReceived + data.received_amount
    const isReceivedInFull = newReceivedTotal >= existing.total_amount

    // Operação atômica: atualizar status + criar transação + atualizar saldo
    const receivable = await prisma.$transaction(async (tx) => {
      const updated = await tx.accountReceivable.update({
        where: { id: params.id },
        data: {
          received_amount: newReceivedTotal,
          status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
          updated_at: new Date(),
        },
      })

      // Registrar transação na conta bancária se especificada
      if (data.account_id) {
        await tx.transaction.create({
          data: {
            company_id: user.companyId,
            account_id: data.account_id,
            transaction_type: 'CREDIT',
            amount: data.received_amount,
            description: `Recebimento: ${existing.description}`,
            transaction_date: data.received_at ? new Date(data.received_at) : new Date(),
          },
        })

        // Atualizar saldo da conta bancária
        await tx.account.update({
          where: { id: data.account_id },
          data: {
            current_balance: { increment: data.received_amount },
            updated_at: new Date(),
          },
        })
      }

      return updated
    })

    // If this is a GROUPED receivable that was fully paid, mark all originals as RECEBIDO
    if (isReceivedInFull && existing.group_id) {
      const originals = await prisma.accountReceivable.findMany({
        where: {
          grouped_into_id: existing.id,
          company_id: user.companyId,
          deleted_at: null,
        },
      })

      if (originals.length > 0) {
        await prisma.accountReceivable.updateMany({
          where: { grouped_into_id: existing.id },
          data: {
            status: 'RECEBIDO',
            received_amount: undefined, // keep original amounts
            updated_at: new Date(),
          },
        })
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.baixa',
      entityId: receivable.id,
      oldValue: { received_amount: previousReceived, status: existing.status },
      newValue: { received_amount: newReceivedTotal, status: receivable.status, account_id: data.account_id },
    })

    return success(receivable)
  } catch (err) {
    return handleError(err)
  }
}
