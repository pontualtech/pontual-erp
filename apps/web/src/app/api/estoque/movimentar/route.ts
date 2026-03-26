import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const movementSchema = z.object({
  product_id: z.string(),
  movement_type: z.enum(['ENTRY', 'EXIT', 'ADJUSTMENT']),
  reason: z.string(),
  quantity: z.number().int().positive(),
  reference_id: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('estoque', 'movimentar')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = movementSchema.parse(body)

    const product = await prisma.product.findFirst({
      where: { id: data.product_id, company_id: user.companyId, deleted_at: null },
    })
    if (!product) return error('Produto não encontrado', 404)

    const currentStock = product.current_stock ?? 0
    let newStock: number

    if (data.movement_type === 'ENTRY') {
      newStock = currentStock + data.quantity
    } else if (data.movement_type === 'EXIT') {
      if (currentStock < data.quantity) {
        return error('Estoque disponível insuficiente', 422)
      }
      newStock = currentStock - data.quantity
    } else {
      newStock = data.quantity // ADJUSTMENT sets absolute value
    }

    const [movement] = await prisma.$transaction([
      prisma.stockMovement.create({
        data: {
          company_id: user.companyId,
          product_id: data.product_id,
          movement_type: data.movement_type,
          reason: data.reason,
          quantity: data.quantity,
          reference_id: data.reference_id,
          notes: data.notes,
          user_id: user.id,
        },
      }),
      prisma.product.update({
        where: { id: data.product_id },
        data: {
          current_stock: newStock,
        },
      }),
    ])

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: `stock.${data.movement_type.toLowerCase()}`,
      entityId: data.product_id,
      newValue: { movement_type: data.movement_type, reason: data.reason, quantity: data.quantity, stockAfter: newStock },
    })

    return success(movement, 201)
  } catch (err) {
    return handleError(err)
  }
}
