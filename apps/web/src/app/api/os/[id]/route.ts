import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { updateOSSchema } from '@/lib/validations/os'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: true,
        user_profiles: { select: { id: true, name: true } },
        service_order_items: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } },
        service_order_photos: { orderBy: { created_at: 'asc' } },
        service_order_history: { orderBy: { created_at: 'desc' }, take: 20 },
        quotes: { orderBy: { created_at: 'desc' } },
      },
    })

    if (!os) return error('OS não encontrada', 404)

    // Enrich history with user names
    const changedByIds = [...new Set(os.service_order_history.map(h => h.changed_by).filter(Boolean))] as string[]
    let userNameMap: Record<string, string> = {}
    if (changedByIds.length > 0) {
      const profiles = await prisma.userProfile.findMany({
        where: { id: { in: changedByIds } },
        select: { id: true, name: true },
      })
      userNameMap = Object.fromEntries(profiles.map(p => [p.id, p.name]))
    }
    const enrichedHistory = os.service_order_history.map(h => ({
      ...h,
      changed_by_name: h.changed_by ? userNameMap[h.changed_by] || null : null,
    }))

    return success({ ...os, service_order_history: enrichedHistory })
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('OS não encontrada', 404)

    const body = await req.json()
    // Validar com Zod strict — rejeita campos não permitidos
    const validated = updateOSSchema.parse(body)

    // Converter strings de data para Date objects para o Prisma
    const data: any = { ...validated }
    if (data.estimated_delivery) data.estimated_delivery = new Date(data.estimated_delivery)
    if (data.actual_delivery) data.actual_delivery = new Date(data.actual_delivery)
    if (data.warranty_until) data.warranty_until = new Date(data.warranty_until)

    const os = await prisma.serviceOrder.update({
      where: { id: params.id },
      data,
      include: { customers: true },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'update',
      entityId: os.id,
      oldValue: existing as any,
      newValue: validated,
    })

    return success(os)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('OS não encontrada', 404)

    await prisma.serviceOrder.update({
      where: { id: params.id },
      data: { deleted_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
