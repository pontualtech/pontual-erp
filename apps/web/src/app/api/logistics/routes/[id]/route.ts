import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const route = await prisma.logisticsRoute.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        driver: { select: { id: true, name: true, phone: true, avatar_url: true } },
      },
    })

    if (!route) return error('Rota não encontrada', 404)

    return success(route)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.logisticsRoute.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Rota não encontrada', 404)

    const body = await req.json()
    const allowedFields: Record<string, any> = {}

    if (body.driver_id !== undefined) allowedFields.driver_id = body.driver_id
    if (body.date !== undefined) allowedFields.date = new Date(body.date)
    if (body.notes !== undefined) allowedFields.notes = body.notes
    if (body.status !== undefined) allowedFields.status = body.status

    allowedFields.updated_at = new Date()

    const updated = await prisma.logisticsRoute.update({
      where: { id: params.id },
      data: allowedFields,
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        driver: { select: { id: true, name: true, phone: true } },
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'update_route',
      entityId: params.id,
      oldValue: existing as any,
      newValue: allowedFields,
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.logisticsRoute.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Rota não encontrada', 404)

    // Delete stops first, then route
    await prisma.$transaction([
      prisma.logisticsStop.deleteMany({ where: { route_id: params.id } }),
      prisma.logisticsRoute.delete({ where: { id: params.id } }),
    ])

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'delete_route',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
