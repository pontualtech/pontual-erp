import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const payment = await prisma.payment.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
      },
      select: {
        id: true,
        status: true,
        amount: true,
        paid_at: true,
        expires_at: true,
        method: true,
        created_at: true,
        receivable_id: true,
      },
    })

    if (!payment) {
      return NextResponse.json({ error: 'Pagamento nao encontrado' }, { status: 404 })
    }

    // Expiracao automatica (PIX)
    if (payment.status === 'PENDING' && payment.expires_at && new Date(payment.expires_at) < new Date()) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'EXPIRED' },
      })
      return NextResponse.json({
        data: { ...payment, status: 'EXPIRED', is_paid: false },
      })
    }

    // Status do AR vinculado — webhook seta AR=RECEBIDO quando Asaas confirma
    let receivableStatus: string | null = null
    if (payment.receivable_id) {
      const ar = await prisma.accountReceivable.findUnique({
        where: { id: payment.receivable_id },
        select: { status: true },
      })
      receivableStatus = ar?.status || null
    }
    const isPaid = payment.status === 'RECEIVED' || payment.status === 'CONFIRMED' || receivableStatus === 'RECEBIDO'

    return NextResponse.json({
      data: { ...payment, receivable_status: receivableStatus, is_paid: isPaid },
    })
  } catch (err) {
    console.error('[Portal Payment Status Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
