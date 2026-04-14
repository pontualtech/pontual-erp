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
      include: { module_statuses: { select: { is_final: true, name: true } } },
    })
    if (!os) return error('OS não encontrada', 404)

    if ((os as any).module_statuses?.is_final) {
      return error('Nao e possivel adicionar itens a uma OS finalizada', 400)
    }

    const body = await req.json()
    const totalPrice = Math.round(Number(body.quantity || 1) * (body.unit_price || body.unitPrice || 0))

    // Wrap item creation + total recalculation in a transaction for atomicity
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.serviceOrderItem.create({
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
      const items = await tx.serviceOrderItem.findMany({
        where: { service_order_id: params.id, deleted_at: null },
      })
      const total_parts = items.filter(i => i.item_type === 'PECA').reduce((s, i) => s + i.total_price, 0)
      const total_services = items.filter(i => i.item_type !== 'PECA').reduce((s, i) => s + i.total_price, 0)
      const total_cost = items.reduce((s, i) => s + i.total_price, 0)

      await tx.serviceOrder.update({
        where: { id: params.id, company_id: user.companyId },
        data: { total_parts, total_services, total_cost },
      })

      return created
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

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const { itemId, description, quantity, unit_price } = body
    if (!itemId) return error('itemId é obrigatório', 400)

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: { module_statuses: { select: { is_final: true } } },
    })
    if (!os) return error('OS não encontrada', 404)
    if ((os as any).module_statuses?.is_final) {
      return error('Nao e possivel editar itens de uma OS finalizada', 400)
    }

    const item = await prisma.serviceOrderItem.findFirst({
      where: { id: itemId, service_order_id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!item) return error('Item não encontrado', 404)

    const rawQty = quantity != null ? Math.round(Number(quantity)) : null
    const rawPrice = unit_price != null ? Math.round(Number(unit_price)) : null

    // Guard against NaN (browser may send empty string for number inputs with step validation)
    const newQty = rawQty != null && !isNaN(rawQty) ? Math.max(1, rawQty) : item.quantity
    const newPrice = rawPrice != null && !isNaN(rawPrice) ? Math.max(0, rawPrice) : item.unit_price
    const newDesc = description != null ? String(description).trim() : item.description
    const newTotal = newQty * newPrice

    console.log(`[Items PATCH] itemId=${itemId} qty=${newQty} price=${newPrice} total=${newTotal} desc=${newDesc.slice(0, 30)}`)

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.serviceOrderItem.updateMany({
        where: { id: itemId, company_id: user.companyId, deleted_at: null },
        data: {
          description: newDesc || item.description,
          quantity: newQty,
          unit_price: newPrice,
          total_price: newTotal,
        },
      })

      if (result.count === 0) {
        throw new Error('Item nao encontrado para atualizar')
      }

      // Recalculate OS totals
      const items = await tx.serviceOrderItem.findMany({
        where: { service_order_id: params.id, deleted_at: null },
      })
      const total_parts = items.filter(i => i.item_type === 'PECA').reduce((s, i) => s + i.total_price, 0)
      const total_services = items.filter(i => i.item_type !== 'PECA').reduce((s, i) => s + i.total_price, 0)
      const total_cost = items.reduce((s, i) => s + i.total_price, 0)

      await tx.serviceOrder.updateMany({
        where: { id: params.id, company_id: user.companyId },
        data: { total_parts, total_services, total_cost },
      })

      return { id: itemId, description: newDesc, quantity: newQty, unit_price: newPrice, total_price: newTotal }
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'edit_item',
      entityId: params.id,
      oldValue: { description: item.description, quantity: item.quantity, unit_price: item.unit_price },
      newValue: { description: newDesc, quantity: newQty, unit_price: newPrice },
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

    const { itemId } = await req.json()
    if (!itemId) return error('itemId é obrigatório', 400)

    const item = await prisma.serviceOrderItem.findFirst({
      where: { id: itemId, service_order_id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!item) return error('Item não encontrado', 404)

    // Wrap soft-delete + total recalculation in a transaction for atomicity
    await prisma.$transaction(async (tx) => {
      await tx.serviceOrderItem.update({
        where: { id: itemId, company_id: user.companyId },
        data: { deleted_at: new Date() },
      })

      // Recalculate totals
      const items = await tx.serviceOrderItem.findMany({
        where: { service_order_id: params.id, deleted_at: null },
      })
      const total_parts = items.filter(i => i.item_type === 'PECA').reduce((s, i) => s + i.total_price, 0)
      const total_services = items.filter(i => i.item_type !== 'PECA').reduce((s, i) => s + i.total_price, 0)
      const total_cost = items.reduce((s, i) => s + i.total_price, 0)

      await tx.serviceOrder.update({
        where: { id: params.id, company_id: user.companyId },
        data: { total_parts, total_services, total_cost },
      })
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
