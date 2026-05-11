import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

/**
 * GET /api/portal/os/[id]/pay-status
 *
 * Retorna status de pagamento consolidado da OS:
 *  - is_paid: true se existe AR RECEBIDO que cobre total_cost
 *  - total_paid: soma de received_amount dos ARs nao-cancelados
 *  - total_due: total_cost da OS
 *
 * UI usa no mount pra decidir se mostra botao "Pagar" ou msg "ja quitada".
 * Evita o bug de cliente gerar multiplos ARs PENDENTES pagando OS ja paga.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      select: { id: true, total_cost: true },
    })
    if (!os) return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })

    const totalDue = os.total_cost || 0
    const ars = await prisma.accountReceivable.findMany({
      where: {
        service_order_id: os.id,
        company_id: portalUser.company_id,
        deleted_at: null,
        status: { notIn: ['CANCELADO'] }, // ignora cancelados
      },
      select: { id: true, status: true, received_amount: true, total_amount: true },
    })

    const totalPaid = ars.reduce((sum, ar) => sum + (ar.received_amount || 0), 0)
    const isPaid = totalDue > 0 && totalPaid >= totalDue

    // 2026-05-11: include active PENDING payment pra UI decidir se mostra
    // os 3 botões de pagamento ou ja oferece reenvio direto do existente.
    // Caso real: cliente clicar PIX e Boleto consecutivamente gerava 2
    // cobrancas pra mesma OS. Agora UI bloqueia via pre-check.
    const activePayment = await prisma.payment.findFirst({
      where: {
        service_order_id: os.id,
        company_id: portalUser.company_id,
        status: 'PENDING',
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        billing_type: true,
        method: true,
        amount: true,
        invoice_url: true,
        expires_at: true,
        created_at: true,
      },
    })

    return NextResponse.json({
      data: {
        total_due: totalDue,
        total_paid: totalPaid,
        total_remaining: Math.max(0, totalDue - totalPaid),
        is_paid: isPaid,
        ar_count: ars.length,
        active_payment: activePayment,
      },
    })
  } catch (err) {
    console.error('[Portal OS pay-status]', err)
    return NextResponse.json({ error: 'Erro' }, { status: 500 })
  }
}
