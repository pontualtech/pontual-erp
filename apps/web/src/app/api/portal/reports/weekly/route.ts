import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const url = new URL(req.url)
    const weekParam = url.searchParams.get('week') // format: 2026-W15

    // Parse week or default to current week
    let startDate: Date
    let endDate: Date

    if (weekParam && /^\d{4}-W\d{2}$/.test(weekParam)) {
      const [year, week] = weekParam.split('-W').map(Number)
      const jan1 = new Date(year, 0, 1)
      const dayOfWeek = jan1.getDay()
      const daysToMonday = dayOfWeek <= 1 ? 1 - dayOfWeek : 8 - dayOfWeek
      startDate = new Date(year, 0, 1 + daysToMonday + (week - 1) * 7)
      endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    } else {
      // Current week
      const now = new Date()
      const dayOfWeek = now.getDay()
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset)
      endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    }

    // Get customer info
    const customer = await prisma.customer.findUnique({
      where: { id: portalUser.customer_id },
      select: { legal_name: true, person_type: true, document_number: true },
    })

    const company = await prisma.company.findUnique({
      where: { id: portalUser.company_id },
      select: { name: true },
    })

    // Get OS for this period
    const orders = await prisma.serviceOrder.findMany({
      where: {
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
        OR: [
          { created_at: { gte: startDate, lt: endDate } },
          { updated_at: { gte: startDate, lt: endDate } },
        ],
      },
      include: {
        module_statuses: { select: { name: true } },
      },
      orderBy: { os_number: 'desc' },
    })

    const fmt = (d: Date) => d.toLocaleDateString('pt-BR')
    const fmtCurrency = (cents: number) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)

    const totalValue = orders.reduce((sum, os) => sum + (os.total_cost || 0), 0)
    const totalOpen = orders.filter(os => !os.module_statuses?.name?.toLowerCase().includes('entreg')).length
    const totalClosed = orders.length - totalOpen

    return NextResponse.json({
      data: {
        company_name: company?.name || 'Empresa',
        customer_name: customer?.legal_name || 'Cliente',
        customer_type: customer?.person_type,
        customer_document: customer?.document_number,
        period: {
          start: fmt(startDate),
          end: fmt(new Date(endDate.getTime() - 86400000)), // end of previous day
          week: weekParam || `${startDate.getFullYear()}-W${String(Math.ceil((startDate.getTime() - new Date(startDate.getFullYear(), 0, 1).getTime()) / 86400000 / 7)).padStart(2, '0')}`,
        },
        summary: {
          total_orders: orders.length,
          total_open: totalOpen,
          total_closed: totalClosed,
          total_value: totalValue,
          total_value_formatted: fmtCurrency(totalValue),
        },
        orders: orders.map(os => {
          // Map internal status to friendly name
          const STATUS_MAP: Record<string, string> = {
            'coletar': 'Recebido', 'orcar': 'Em Analise', 'negociar': 'Em Analise',
            'laudo': 'Em Analise', 'recalculado': 'Aguardando Aprovacao',
            'aguardando aprov': 'Aguardando Aprovacao', 'aprovado': 'Em Reparo',
            'em execu': 'Em Reparo', 'aguardando pe': 'Em Reparo',
            'entregar reparado': 'Pronto para Retirada', 'entregar recusado': 'Pronto para Retirada',
            'entregue': 'Entregue', 'cancelada': 'Cancelada',
          }
          const rawName = os.module_statuses?.name?.toLowerCase() || ''
          const friendlyKey = Object.keys(STATUS_MAP).find(k => rawName.includes(k))
          const friendlyStatus = friendlyKey ? STATUS_MAP[friendlyKey] : os.module_statuses?.name || '-'
          return {
          os_number: os.os_number,
          equipment: `${os.equipment_type}${os.equipment_brand ? ` ${os.equipment_brand}` : ''}${os.equipment_model ? ` ${os.equipment_model}` : ''}`,
          status: friendlyStatus,
          value: os.total_cost || 0,
          value_formatted: fmtCurrency(os.total_cost || 0),
          created_at: os.created_at ? fmt(new Date(os.created_at)) : '-',
        }}),
      },
    })
  } catch (err) {
    console.error('[Portal Weekly Report Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
