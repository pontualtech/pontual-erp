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

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: true,
        service_order_items: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } },
        service_order_photos: { orderBy: { created_at: 'asc' } },
        service_order_history: { orderBy: { created_at: 'desc' }, take: 20 },
        quotes: { orderBy: { created_at: 'desc' } },
      },
    })

    if (!os) return error('OS não encontrada', 404)
    return success(os)
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
    // Don't allow changing status_id via PUT — use /transition endpoint
    delete body.status_id
    delete body.statusId
    delete body.company_id
    delete body.companyId
    delete body.os_number
    delete body.osNumber

    const os = await prisma.serviceOrder.update({
      where: { id: params.id },
      data: body,
      include: { customers: true },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'update',
      entityId: os.id,
      oldValue: existing as any,
      newValue: body,
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
