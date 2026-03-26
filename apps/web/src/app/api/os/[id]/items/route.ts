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
      select: { id: true },
    })
    if (!os) return error('OS não encontrada', 404)

    const items = await prisma.serviceOrderItem.findMany({
      where: { service_order_id: params.id, company_id: user.companyId, deleted_at: null },
      orderBy: { created_at: 'asc' },
    })

    return success(items)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!os) return error('OS não encontrada', 404)

    const body = await req.json()
    const totalPrice = Math.round(Number(body.quantity || 1) * (body.unit_price || body.unitPrice || 0))

    const item = await prisma.serviceOrderItem.create({
      data: {
        company_id: user.companyId,
        service_order_id: params.id,
        item_type: body.item_type || body.itemType || 'PECA',
        product_id: body.product_id || body.productId || null,
        description: body.description,
        quantity: body.quantity || 1,
        unit_price: body.unit_price || body.unitPrice || 0,
        total_price: totalPrice,
      },
    })

    // Recalculate OS totals
    const items = await prisma.serviceOrderItem.findMany({
      where: { service_order_id: params.id, deleted_at: null },
    })
    const total_parts = items.filter(i => i.item_type === 'PECA').reduce((s, i) => s + i.total_price, 0)
    const total_services = items.filter(i => i.item_type !== 'PECA').reduce((s, i) => s + i.total_price, 0)
    const total_cost = items.reduce((s, i) => s + i.total_price, 0)

    await prisma.serviceOrder.update({
      where: { id: params.id },
      data: { total_parts, total_services, total_cost },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'add_item',
      entityId: params.id,
      newValue: body,
    })

    return success(item, 201)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const { itemId } = await req.json()
    if (!itemId) return error('itemId é obrigatório', 400)

    const item = await prisma.serviceOrderItem.findFirst({
      where: { id: itemId, service_order_id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!item) return error('Item não encontrado', 404)

    await prisma.serviceOrderItem.update({
      where: { id: itemId },
      data: { deleted_at: new Date() },
    })

    // Recalculate totals
    const items = await prisma.serviceOrderItem.findMany({
      where: { service_order_id: params.id, deleted_at: null },
    })
    const total_parts = items.filter(i => i.item_type === 'PECA').reduce((s, i) => s + i.total_price, 0)
    const total_services = items.filter(i => i.item_type !== 'PECA').reduce((s, i) => s + i.total_price, 0)
    const total_cost = items.reduce((s, i) => s + i.total_price, 0)

    await prisma.serviceOrder.update({
      where: { id: params.id },
      data: { total_parts, total_services, total_cost },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'remove_item',
      entityId: params.id,
      oldValue: item as any,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
