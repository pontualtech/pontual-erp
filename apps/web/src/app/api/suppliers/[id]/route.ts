import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const updateSupplierSchema = z.object({
  name: z.string().min(1).optional(),
  document: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  avg_delivery_days: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
})

type RouteParams = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('estoque', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const supplier = await prisma.supplier.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        purchases: {
          take: 10,
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            created_at: true,
          },
        },
        _count: { select: { purchases: true, products: true } },
      },
    })

    if (!supplier) return error('Fornecedor não encontrado', 404)
    return success(supplier)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('estoque', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.supplier.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Fornecedor não encontrado', 404)

    const body = await request.json()
    const data = updateSupplierSchema.parse(body)

    await prisma.supplier.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data,
    })
    const supplier = await prisma.supplier.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: 'supplier.update',
      entityId: supplier!.id,
      oldValue: { name: existing.name },
      newValue: { name: supplier!.name },
    })

    return success(supplier!)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('estoque', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.supplier.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Fornecedor não encontrado', 404)

    // Soft-delete: just deactivate
    await prisma.supplier.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: { is_active: false },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'estoque',
      action: 'supplier.delete',
      entityId: params.id,
      oldValue: { name: existing.name },
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
