import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))
    const date = url.get('date') || null
    const driverId = url.get('driver_id') || null
    const status = url.get('status') || null

    const where: any = {
      company_id: user.companyId,
    }

    if (date) {
      where.date = new Date(date)
    }
    if (driverId) {
      where.driver_id = driverId
    }
    if (status) {
      where.status = status
    }

    const [data, total] = await Promise.all([
      prisma.logisticsRoute.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { date: 'desc' },
        include: {
          driver: { select: { id: true, name: true, phone: true } },
          _count: { select: { stops: true } },
        },
      }),
      prisma.logisticsRoute.count({ where }),
    ])

    return paginated(data, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const { driver_id, date, notes, stops } = body

    if (!date) return error('Data é obrigatória', 400)
    if (!stops || !Array.isArray(stops) || stops.length === 0) {
      return error('Pelo menos uma parada é obrigatória', 400)
    }

    // Validate driver exists if provided
    if (driver_id) {
      const driver = await prisma.userProfile.findFirst({
        where: { id: driver_id, company_id: user.companyId, is_active: true },
      })
      if (!driver) return error('Motorista não encontrado', 404)
    }

    const route = await prisma.$transaction(async (tx) => {
      const created = await tx.logisticsRoute.create({
        data: {
          company_id: user.companyId,
          driver_id: driver_id || null,
          date: new Date(date),
          status: 'PLANNED',
          total_stops: stops.length,
          completed_stops: 0,
          notes: notes || null,
        },
      })

      // Create stops
      const stopsData = stops.map((stop: any, index: number) => ({
        company_id: user.companyId,
        route_id: created.id,
        os_id: stop.os_id || null,
        type: stop.type, // COLETA | ENTREGA
        sequence: stop.sequence ?? index + 1,
        status: 'PENDING',
        customer_name: stop.customer_name || null,
        customer_phone: stop.customer_phone || null,
        address: stop.address,
        address_complement: stop.address_complement || null,
        lat: stop.lat || null,
        lng: stop.lng || null,
        scheduled_window_start: stop.scheduled_window_start || null,
        scheduled_window_end: stop.scheduled_window_end || null,
        notes: stop.notes || null,
      }))

      await tx.logisticsStop.createMany({ data: stopsData })

      return created
    })

    const full = await prisma.logisticsRoute.findUnique({
      where: { id: route.id },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        driver: { select: { id: true, name: true, phone: true } },
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'create_route',
      entityId: route.id,
      newValue: { date, driver_id, total_stops: stops.length },
    })

    return success(full, 201)
  } catch (err) {
    return handleError(err)
  }
}
