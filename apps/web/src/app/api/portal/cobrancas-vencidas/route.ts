import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

/**
 * GET /api/portal/cobrancas-vencidas
 *
 * Lista cobrancas vencidas do cliente logado pra mostrar banner de alerta
 * no portal (home + pagina OS especifica). Cada item tem charge_url
 * (link Asaas) pra acao "Pagar agora".
 *
 * Feature 2026-05-14 (feat 6/7): alerta no portal cliente com link de
 * pagamento direto. Sem fluxo de "pedir nova data" ou anexar comprovante.
 */
export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    // Cobrancas "vencidas" do ponto de vista do cliente:
    // 1. charge_status = OVERDUE (Asaas confirmou que venceu)
    // 2. OU charge_status = PENDING + due_date < hoje
    // Audit fix 2026-05-14 #2: UTC explicito (consistencia com AR.due_date).
    const now = new Date()
    const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z')

    const cobrancas = await prisma.accountReceivable.findMany({
      where: {
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
        status: 'PENDENTE',
        OR: [
          { charge_status: 'OVERDUE' },
          { charge_status: 'PENDING', due_date: { lt: today } },
        ],
      },
      orderBy: { due_date: 'asc' },
      take: 20,
      select: {
        id: true,
        description: true,
        total_amount: true,
        received_amount: true,
        due_date: true,
        charge_url: true,
        charge_status: true,
        service_order_id: true,
        service_orders: { select: { os_number: true } },
      },
    })

    return NextResponse.json({
      data: cobrancas.map(c => ({
        id: c.id,
        description: c.description,
        amount_cents: c.total_amount - (c.received_amount || 0),
        due_date: c.due_date,
        charge_url: c.charge_url,
        charge_status: c.charge_status,
        service_order_id: c.service_order_id,
        os_number: c.service_orders?.os_number || null,
      })),
    })
  } catch (err) {
    console.error('[portal-cobrancas-vencidas]', err)
    return NextResponse.json({ error: 'Erro ao listar cobrancas' }, { status: 500 })
  }
}
