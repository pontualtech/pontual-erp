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
      },
    })

    if (!payment) {
      return NextResponse.json({ error: 'Pagamento nao encontrado' }, { status: 404 })
    }

    // Check if expired
    if (payment.status === 'PENDING' && payment.expires_at && new Date(payment.expires_at) < new Date()) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'EXPIRED' },
      })
      return NextResponse.json({
        data: { ...payment, status: 'EXPIRED' },
      })
    }

    return NextResponse.json({ data: payment })
  } catch (err) {
    console.error('[Portal Payment Status Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
