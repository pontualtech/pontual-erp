import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const updatePurchaseSchema = z.object({
  status: z.enum(['DRAFT', 'APPROVED', 'ORDERED', 'RECEIVED', 'CANCELLED']).optional(),
  number: z.string().optional(),
  nfe_key: z.string().optional(),
  expected_delivery: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

type RouteParams = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('compras', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const purchase = await prisma.purchase.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        suppliers: true,
        purchase_items: {
          include: {
            products: { select: { id: true, name: true, current_stock: true, unit: true } },
          },
        },
      },
    })

    if (!purchase) return error('Pedido de compra não encontrado', 404)
    return success(purchase)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('compras', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.purchase.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { purchase_items: true, suppliers: true },
    })
    if (!existing) return error('Pedido de compra não encontrado', 404)

    const body = await request.json()
    const data = updatePurchaseSchema.parse(body)

    // If changing status to RECEIVED, process stock + financeiro
    if (data.status === 'RECEIVED' && existing.status !== 'RECEIVED') {
      await receivePurchase(existing, user)
    }

    const purchase = await prisma.purchase.update({
      where: { id: params.id, company_id: user.companyId },
      data: {
        ...data,
        expected_delivery: data.expected_delivery !== undefined
          ? (data.expected_delivery ? new Date(data.expected_delivery) : null)
          : undefined,
        received_at: data.status === 'RECEIVED' ? new Date() : undefined,
      },
      include: { purchase_items: true, suppliers: true },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'compras',
      action: 'purchase.update',
      entityId: purchase.id,
      oldValue: { status: existing.status },
      newValue: { status: purchase.status },
    })

    return success(purchase)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * When a purchase is received:
 * 1. Create StockMovement (ENTRY) for each item with a product_id
 * 2. Update product.current_stock += quantity
 * 3. Update product.avg_cost (weighted average)
 * 4. Create AccountPayable for the supplier
 */
async function receivePurchase(
  purchase: any,
  user: { id: string; companyId: string }
) {
  const items = purchase.purchase_items || []
  const operations: any[] = []

  for (const item of items) {
    if (!item.product_id) continue

    // Fetch current product state for weighted average
    const product = await prisma.product.findUnique({
      where: { id: item.product_id },
      select: { current_stock: true, avg_cost: true, cost_price: true },
    })
    if (!product) continue

    const currentStock = product.current_stock ?? 0
    const currentAvgCost = product.avg_cost ?? product.cost_price ?? 0
    const newStock = currentStock + item.quantity

    // Weighted average cost: (currentStock * avgCost + qty * unitCost) / newStock
    const newAvgCost = newStock > 0
      ? Math.round(
          (currentStock * currentAvgCost + item.quantity * item.unit_cost) / newStock
        )
      : item.unit_cost

    // Stock movement
    operations.push(
      prisma.stockMovement.create({
        data: {
          company_id: user.companyId,
          product_id: item.product_id,
          movement_type: 'ENTRY',
          reason: 'COMPRA',
          quantity: item.quantity,
          reference_id: purchase.id,
          notes: `Pedido de compra ${purchase.number || purchase.id}`,
          user_id: user.id,
        },
      })
    )

    // Update product stock + avg cost + last purchase date
    operations.push(
      prisma.product.update({
        where: { id: item.product_id },
        data: {
          current_stock: newStock,
          avg_cost: newAvgCost,
          cost_price: item.unit_cost,
          last_purchase_date: new Date(),
        },
      })
    )
  }

  // Create AccountPayable for the supplier
  if (purchase.total && purchase.total > 0) {
    const dueDate = purchase.expected_delivery || new Date()
    operations.push(
      prisma.accountPayable.create({
        data: {
          company_id: user.companyId,
          supplier_id: purchase.supplier_id,
          description: `Compra ${purchase.number || ''} - ${purchase.suppliers?.name || 'Fornecedor'}`.trim(),
          total_amount: purchase.total,
          due_date: dueDate,
          status: 'PENDENTE',
          notes: `Ref. pedido de compra #${purchase.number || purchase.id}`,
        },
      })
    )
  }

  if (operations.length > 0) {
    await prisma.$transaction(operations)
  }
}
