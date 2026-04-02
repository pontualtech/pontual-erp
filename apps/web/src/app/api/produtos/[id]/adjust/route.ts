import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const adjustSchema = z.object({
  quantity: z.number().int(),
  reason: z.string().min(1),
  notes: z.string().optional(),
})

type RouteParams = { params: { id: string } }

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('estoque', 'movimentar')
    if (result instanceof NextResponse) return result
    const user = result

    const product = await prisma.product.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!product) return error('Produto não encontrado', 404)

    const body = await request.json()
    const data = adjustSchema.parse(body)

    const currentStock = product.current_stock ?? 0
    const newStock = data.quantity // Adjustment sets absolute value
    const diff = newStock - currentStock

    const [movement] = await prisma.$transaction([
      prisma.stockMovement.create({
        data: {
          company_id: user.companyId,
          product_id: params.id,
          movement_type: 'ADJUSTMENT',
          reason: data.reason,
          quantity: Math.abs(diff),
          notes: data.notes
            ? `${data.notes} | Estoque anterior: ${currentStock}, Novo: ${newStock}`
            : `Estoque anterior: ${currentStock}, Novo: ${newStock}`,
          user_id: user.id,
        },
      }),
      prisma.product.update({
        where: { id: params.id },
        data: { current_stock: newStock },
      }),
    ])

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: 'stock.adjustment',
      entityId: params.id,
      oldValue: { current_stock: currentStock },
      newValue: { current_stock: newStock, reason: data.reason },
    })

    return success(movement, 201)
  } catch (err) {
    return handleError(err)
  }
}
