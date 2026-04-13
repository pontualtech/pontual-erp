import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

type Params = { params: { id: string } }

const baixaSchema = z.object({
  paid_amount: z.number().int().positive('Valor pago deve ser positivo'),
  paid_at: z.string().optional(),
  account_id: z.string().optional(),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a pagar nao encontrada', 404)
    if (existing.status === 'PAGO') return error('Conta ja esta paga', 400)
    if (existing.status === 'CANCELADO') return error('Conta cancelada nao pode ser paga', 400)

    const body = await req.json()
    const data = baixaSchema.parse(body)

    // Validate account ownership if provided
    if (data.account_id) {
      const account = await prisma.account.findFirst({
        where: { id: data.account_id, company_id: user.companyId },
      })
      if (!account) return error('Conta bancaria nao pertence a esta empresa', 403)
    }

    const previousPaid = existing.paid_amount || 0
    const newPaidTotal = previousPaid + data.paid_amount
    const isPaidInFull = newPaidTotal >= existing.total_amount

    // Atomic transaction: update payable + record bank transaction + update balance
    const payable = await prisma.$transaction(async (tx) => {
      const updated = await tx.accountPayable.update({
        where: { id: params.id, company_id: user.companyId },
        data: {
          paid_amount: newPaidTotal,
          status: isPaidInFull ? 'PAGO' : 'PENDENTE',
          payment_method: existing.payment_method,
          updated_at: new Date(),
        },
      })

      if (data.account_id) {
        await tx.transaction.create({
          data: {
            company_id: user.companyId,
            account_id: data.account_id,
            transaction_type: 'DEBIT',
            amount: data.paid_amount,
            description: `Pgto: ${existing.description}`,
            transaction_date: data.paid_at ? new Date(data.paid_at) : new Date(),
          },
        })

        await tx.account.update({
          where: { id: data.account_id },
          data: {
            current_balance: { decrement: data.paid_amount },
            updated_at: new Date(),
          },
        })
      }

      return updated
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.baixa',
      entityId: payable.id,
      oldValue: { paid_amount: previousPaid, status: existing.status },
      newValue: { paid_amount: newPaidTotal, status: payable.status, account_id: data.account_id },
    })

    return success(payable)
  } catch (err) {
    return handleError(err)
  }
}
