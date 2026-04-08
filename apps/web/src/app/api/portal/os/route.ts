import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const body = await req.json()

    const { equipment_type, brand, model, serial_number, reported_issue, preferred_date } = body

    if (!equipment_type || !reported_issue) {
      return NextResponse.json(
        { error: 'Tipo de equipamento e defeito relatado sao obrigatorios' },
        { status: 400 }
      )
    }

    // Find initial status (is_default or lowest order) for this company's OS module
    let initialStatus = await prisma.moduleStatus.findFirst({
      where: { company_id: portalUser.company_id, module: 'os', is_default: true },
    })
    if (!initialStatus) {
      initialStatus = await prisma.moduleStatus.findFirst({
        where: { company_id: portalUser.company_id, module: 'os' },
        orderBy: { order: 'asc' },
      })
    }
    if (!initialStatus) {
      return NextResponse.json({ error: 'Status inicial nao configurado' }, { status: 500 })
    }

    // Create OS with atomic numbering (same pattern as internal API)
    const os = await prisma.$transaction(async (tx) => {
      const lockKey = Buffer.from(portalUser.company_id).reduce((acc, b) => acc + b, 0)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`

      const result = await tx.$queryRaw<{ next_number: number }[]>`
        SELECT COALESCE(MAX(os_number), 0) + 1 as next_number
        FROM service_orders
        WHERE company_id = ${portalUser.company_id}
      `
      const nextNumber = result[0]?.next_number || 1

      const created = await tx.serviceOrder.create({
        data: {
          company_id: portalUser.company_id,
          os_number: nextNumber,
          customer_id: portalUser.customer_id,
          status_id: initialStatus!.id,
          priority: 'MEDIUM',
          os_type: 'PORTAL',
          os_location: 'EXTERNO',
          equipment_type,
          equipment_brand: brand || null,
          equipment_model: model || null,
          serial_number: serial_number || null,
          reported_issue,
          estimated_delivery: preferred_date ? new Date(preferred_date) : undefined,
        },
        include: {
          module_statuses: {
            select: { id: true, name: true, color: true },
          },
        },
      })

      // Log initial status in history
      await tx.serviceOrderHistory.create({
        data: {
          company_id: portalUser.company_id,
          service_order_id: created.id,
          to_status_id: initialStatus!.id,
          changed_by: portalUser.customer_id,
          notes: 'OS criada pelo portal do cliente',
        },
      })

      return created
    })

    return NextResponse.json({
      data: {
        id: os.id,
        os_number: os.os_number,
        equipment_type: os.equipment_type,
        equipment_brand: os.equipment_brand,
        equipment_model: os.equipment_model,
        reported_issue: os.reported_issue,
        created_at: os.created_at,
        status: os.module_statuses,
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[Portal OS Create Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

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

    // Remover campos internos e mapear status ocultos antes de enviar ao cliente
    const HIDDEN_PORTAL_STATUSES = ['orcar', 'negociar', 'recalculado']
    const safeData = data.map(os => {
      const statusName = os.module_statuses?.name || ''
      const isHidden = HIDDEN_PORTAL_STATUSES.some(h => statusName.toLowerCase().includes(h))
      return {
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
        status: isHidden ? { ...os.module_statuses, name: 'Em Analise', color: '#F59E0B' } : os.module_statuses,
      }
    })

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
