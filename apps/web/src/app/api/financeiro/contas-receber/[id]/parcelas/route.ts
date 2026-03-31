import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const receivable = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: {
        id: true,
        description: true,
        total_amount: true,
        net_amount: true,
        received_amount: true,
        status: true,
        payment_method: true,
        installment_count: true,
        card_fee_total: true,
        anticipated_at: true,
        anticipation_fee: true,
        anticipated_amount: true,
      },
    })

    if (!receivable) return error('Conta a receber nao encontrada', 404)

    const installments = await prisma.installment.findMany({
      where: { parent_type: 'RECEIVABLE', parent_id: receivable.id },
      orderBy: { installment_number: 'asc' },
    })

    return success({
      receivable,
      installments,
    })
  } catch (err) {
    return handleError(err)
  }
}
