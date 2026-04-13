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

    // Verify product exists before entering transaction
    const productCheck = await prisma.product.findFirst({
      where: { id: data.product_id, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })
    if (!productCheck) return error('Produto não encontrado', 404)

    // BL-15: Use interactive transaction with FOR UPDATE to prevent race conditions
    const movement = await prisma.$transaction(async (tx) => {
      const [product] = await tx.$queryRaw<{ current_stock: number }[]>`
        SELECT current_stock FROM products WHERE id = ${data.product_id} AND company_id = ${user.companyId} AND deleted_at IS NULL FOR UPDATE
      `
      if (!product) throw new Error('Produto não encontrado')

      const currentStock = product.current_stock ?? 0
      let newStock: number

      if (data.movement_type === 'ENTRY') {
        newStock = currentStock + data.quantity
      } else if (data.movement_type === 'EXIT') {
        if (currentStock < data.quantity) {
          throw new Error('Estoque disponível insuficiente')
        }
        newStock = currentStock - data.quantity
      } else {
        newStock = data.quantity // ADJUSTMENT sets absolute value
      }

      const mov = await tx.stockMovement.create({
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
      })

      await tx.product.update({
        where: { id: data.product_id },
        data: { current_stock: newStock },
      })

      return { mov, newStock }
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: `stock.${data.movement_type.toLowerCase()}`,
      entityId: data.product_id,
      newValue: { movement_type: data.movement_type, reason: data.reason, quantity: data.quantity, stockAfter: movement.newStock },
    })

    return success(movement.mov, 201)
  } catch (err: any) {
    if (err?.message === 'Estoque disponível insuficiente') {
      return error('Estoque disponível insuficiente', 422)
    }
    return handleError(err)
  }
}
