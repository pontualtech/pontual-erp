import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(50, Math.max(1, Number(url.get('limit') || '20')))
    const statusId = url.get('statusId') || null

    const where: any = {
      company_id: portalUser.company_id,
      customer_id: portalUser.customer_id,
      deleted_at: null,
    }

    if (statusId) where.status_id = statusId

    const [data, total] = await Promise.all([
      prisma.serviceOrder.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          module_statuses: {
            select: { id: true, name: true, color: true, icon: true },
          },
        },
      }),
      prisma.serviceOrder.count({ where }),
    ])

    // Remover campos internos antes de enviar ao cliente
    const safeData = data.map(os => ({
      id: os.id,
      os_number: os.os_number,
      equipment_type: os.equipment_type,
      equipment_brand: os.equipment_brand,
      equipment_model: os.equipment_model,
      reported_issue: os.reported_issue,
      diagnosis: os.diagnosis,
      priority: os.priority,
      os_type: os.os_type,
      estimated_cost: os.estimated_cost,
      total_cost: os.total_cost,
      estimated_delivery: os.estimated_delivery,
      actual_delivery: os.actual_delivery,
      created_at: os.created_at,
      updated_at: os.updated_at,
      status: os.module_statuses,
    }))

    return NextResponse.json({
      data: safeData,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err) {
    console.error('[Portal OS List Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
