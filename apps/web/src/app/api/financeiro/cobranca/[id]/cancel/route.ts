import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { getPaymentProvider } from '@/lib/payments/factory'

/**
 * POST /api/financeiro/cobranca/[id]/cancel
 * Cancel a pending or overdue charge in Asaas
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const payment = await prisma.payment.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
      },
    })

    if (!payment) {
      return NextResponse.json({ error: 'Cobranca nao encontrada' }, { status: 404 })
    }

    if (!['PENDING', 'OVERDUE'].includes(payment.status)) {
      return NextResponse.json(
        { error: `Nao e possivel cancelar cobranca com status ${payment.status}` },
        { status: 400 }
      )
    }

    // Cancel in Asaas FIRST — only proceed locally if gateway succeeds
    if (payment.external_id) {
      const provider = getPaymentProvider() as { cancelCharge?: (id: string) => Promise<void> }
      if (provider.cancelCharge) {
        await provider.cancelCharge(payment.external_id)
      }
    }

    // Update payment and receivable atomically (only if Asaas succeeded)
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'CANCELLED',
          cancelled_at: new Date(),
          updated_at: new Date(),
        },
      })

      if (payment.receivable_id) {
        await tx.accountReceivable.update({
          where: { id: payment.receivable_id },
          data: {
            charge_id: null,
            charge_status: null,
            charge_url: null,
            updated_at: new Date(),
          },
        })
      }
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'charge_cancelled',
      entityId: payment.receivable_id || payment.id,
      newValue: {
        payment_id: payment.id,
        billing_type: payment.billing_type,
        amount: payment.amount,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[Cancel] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro ao cancelar cobranca' },
      { status: 500 }
    )
  }
}
