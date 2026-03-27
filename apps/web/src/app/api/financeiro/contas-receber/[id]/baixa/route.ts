import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

type Params = { params: { id: string } }

const baixaSchema = z.object({
  received_amount: z.number().int().positive('Valor recebido deve ser positivo'),
  received_at: z.string().optional(),
  account_id: z.string().optional(),
})

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

    const receivable = await prisma.accountReceivable.update({
      where: { id: params.id },
      data: {
        received_amount: newReceivedTotal,
        status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
        updated_at: new Date(),
      },
    })

    // Record transaction in bank account if specified
    if (data.account_id) {
      await prisma.transaction.create({
        data: {
          company_id: user.companyId,
          account_id: data.account_id,
          transaction_type: 'CREDIT',
          amount: data.received_amount,
          description: `Recebimento: ${existing.description}`,
          transaction_date: data.received_at ? new Date(data.received_at) : new Date(),
        },
      })

      // Update bank account balance
      await prisma.account.update({
        where: { id: data.account_id },
        data: {
          current_balance: { increment: data.received_amount },
          updated_at: new Date(),
        },
      })
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
