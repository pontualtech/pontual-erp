import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    // Get all OS with values for this customer
    const orders = await prisma.serviceOrder.findMany({
      where: {
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
        total_cost: { gt: 0 },
      },
      include: {
        module_statuses: { select: { name: true, color: true, is_final: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    // Status friendly map
    const STATUS_MAP: Record<string, string> = {
      'coletar': 'Recebido', 'orcar': 'Em Analise', 'negociar': 'Em Analise',
      'aguardando aprov': 'Aguardando Aprovacao', 'aprovado': 'Em Reparo',
      'em execu': 'Em Reparo', 'aguardando pe': 'Em Reparo',
      'entregar reparado': 'Pronto para Retirada', 'entregue': 'Entregue',
      'cancelada': 'Cancelada',
    }

    function friendlyStatus(name: string) {
      const key = Object.keys(STATUS_MAP).find(k => name.toLowerCase().includes(k))
      return key ? STATUS_MAP[key] : name
    }

    // Get all payments for this customer
    const payments = await prisma.payment.findMany({
      where: {
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        service_order_id: true,
        amount: true,
        status: true,
        method: true,
        paid_at: true,
        created_at: true,
      },
    })

    // Build payment map by OS
    const paymentsByOs: Record<string, typeof payments> = {}
    for (const p of payments) {
      const osId = p.service_order_id ?? 'no-os'
      if (!paymentsByOs[osId]) paymentsByOs[osId] = []
      paymentsByOs[osId].push(p)
    }

    const fmt = (cents: number) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)

    // Build response
    const items = orders.map(os => {
      const osPayments = paymentsByOs[os.id] || []
      const confirmedPayment = osPayments.find(p => p.status === 'CONFIRMED')
      const pendingPayment = osPayments.find(p => p.status === 'PENDING')

      let paymentStatus: 'paid' | 'pending' | 'unpaid' = 'unpaid'
      if (confirmedPayment) paymentStatus = 'paid'
      else if (pendingPayment) paymentStatus = 'pending'

      return {
        os_id: os.id,
        os_number: os.os_number,
        equipment: `${os.equipment_type}${os.equipment_brand ? ` ${os.equipment_brand}` : ''}${os.equipment_model ? ` ${os.equipment_model}` : ''}`,
        status: friendlyStatus(os.module_statuses?.name || ''),
        status_color: os.module_statuses?.color || '#3B82F6',
        is_final: os.module_statuses?.is_final || false,
        total_cost: os.total_cost || 0,
        total_cost_formatted: fmt(os.total_cost || 0),
        payment_method: os.payment_method,
        payment_status: paymentStatus,
        paid_at: confirmedPayment?.paid_at || null,
        pending_payment_id: pendingPayment?.id || null,
        created_at: os.created_at,
      }
    })

    // Summary
    const totalValue = items.reduce((sum, i) => sum + i.total_cost, 0)
    const totalPaid = items.filter(i => i.payment_status === 'paid').reduce((sum, i) => sum + i.total_cost, 0)
    const totalPending = items.filter(i => i.payment_status !== 'paid' && !i.is_final).reduce((sum, i) => sum + i.total_cost, 0)

    return NextResponse.json({
      data: {
        summary: {
          total: fmt(totalValue),
          paid: fmt(totalPaid),
          pending: fmt(totalPending),
          total_cents: totalValue,
          paid_cents: totalPaid,
          pending_cents: totalPending,
        },
        items,
      },
    })
  } catch (err) {
    console.error('[Portal Financeiro Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
