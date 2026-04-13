import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  barcode: z.string().optional(),
  internal_code: z.string().optional(),
  category_id: z.string().nullable().optional(),
  brand: z.string().optional(),
  unit: z.string().optional(),
  cost_price: z.number().int().min(0).optional(),
  sale_price: z.number().int().min(0).optional(),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  min_stock: z.number().optional(),
  max_stock: z.number().optional(),
  photo_url: z.string().optional(),
  is_active: z.boolean().optional(),
})

type RouteParams = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('estoque', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const product = await prisma.product.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        categories: { select: { id: true, name: true } },
        stock_movements: { take: 10, orderBy: { created_at: 'desc' } },
      },
    })

    if (!product) return error('Produto não encontrado', 404)
    return success(product)
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('estoque', 'update')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.product.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Produto não encontrado', 404)

    const body = await request.json()
    const data = updateProductSchema.parse(body)

    await prisma.product.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data,
    })
    const product = await prisma.product.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: 'product.update',
      entityId: product!.id,
      oldValue: { name: existing.name, sale_price: existing.sale_price },
      newValue: { name: product!.name, sale_price: product!.sale_price },
    })

    return success(product!)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('estoque', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.product.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Produto não encontrado', 404)

    await prisma.product.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: { deleted_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: 'product.delete',
      entityId: params.id,
      oldValue: { name: existing.name },
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
