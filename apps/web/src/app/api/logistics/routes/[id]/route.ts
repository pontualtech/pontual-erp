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

    // Enrich stops com dados de OS (os_number, equipamento, issue) —
    // usado pela tela de impressao e pela timeline de detalhes. Buscado
    // em lote pra evitar N+1.
    const osIds = route.stops.map(s => s.os_id).filter(Boolean) as string[]
    const osList = osIds.length === 0 ? [] : await prisma.serviceOrder.findMany({
      where: { id: { in: osIds }, company_id: user.companyId },
      select: {
        id: true,
        os_number: true,
        equipment_type: true,
        equipment_brand: true,
        equipment_model: true,
        reported_issue: true,
        total_cost: true,
        customers: { select: { legal_name: true, mobile: true, phone: true } },
      },
    })
    const osById = new Map(osList.map(o => [o.id, o]))

    const stopsEnriched = route.stops.map(s => {
      const os = s.os_id ? osById.get(s.os_id) : null
      return {
        ...s,
        os_number: os?.os_number ?? null,
        equipment_type: os?.equipment_type ?? null,
        equipment_brand: os?.equipment_brand ?? null,
        equipment_model: os?.equipment_model ?? null,
        reported_issue: os?.reported_issue ?? null,
        os_total_cost_cents: os?.total_cost ?? null,
        customer_name: s.customer_name || os?.customers?.legal_name || null,
        customer_phone: s.customer_phone || os?.customers?.mobile || os?.customers?.phone || null,
      }
    })

    return success({ ...route, stops: stopsEnriched })
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
      where: { id: params.id, company_id: user.companyId },
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
      prisma.logisticsStop.deleteMany({ where: { route_id: params.id, company_id: user.companyId } }),
      prisma.logisticsRoute.delete({ where: { id: params.id, company_id: user.companyId } }),
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
