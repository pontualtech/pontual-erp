import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const updateCostCenterSchema = z.object({
  name: z.string().min(1).optional(),
  parent_id: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
})

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const costCenter = await prisma.costCenter.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        cost_centers: { select: { id: true, name: true } },
        other_cost_centers: { select: { id: true, name: true } },
      },
    })

    if (!costCenter) return error('Centro de custo não encontrado', 404)
    return success(costCenter)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.costCenter.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Centro de custo não encontrado', 404)

    const body = await req.json()
    const data = updateCostCenterSchema.parse(body)

    // Validate parent if provided
    if (data.parent_id) {
      if (data.parent_id === params.id) {
        return error('Centro de custo não pode ser pai de si mesmo', 400)
      }
      const parent = await prisma.costCenter.findFirst({
        where: { id: data.parent_id, company_id: user.companyId },
      })
      if (!parent) return error('Centro de custo pai não encontrado', 404)
    }

    await prisma.costCenter.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.parent_id !== undefined && { parent_id: data.parent_id }),
        ...(data.is_active !== undefined && { is_active: data.is_active }),
      },
    })
    const costCenter = await prisma.costCenter.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'cost_center.update',
      entityId: costCenter!.id,
      oldValue: { name: existing.name, is_active: existing.is_active },
      newValue: data as Record<string, unknown>,
    })

    return success(costCenter!)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.costCenter.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Centro de custo não encontrado', 404)

    // Check if cost center is used in accounts_payable
    const usedInPayable = await prisma.accountPayable.count({
      where: { cost_center_id: params.id, company_id: user.companyId },
    })
    if (usedInPayable > 0) {
      return error(`Centro de custo em uso em ${usedInPayable} conta(s) a pagar. Remova as referências antes de excluir.`, 409)
    }

    // Check if it has children
    const childCount = await prisma.costCenter.count({
      where: { parent_id: params.id, company_id: user.companyId },
    })
    if (childCount > 0) {
      return error(`Centro de custo possui ${childCount} filho(s). Remova ou mova os filhos antes de excluir.`, 409)
    }

    await prisma.costCenter.deleteMany({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'cost_center.delete',
      entityId: params.id,
      oldValue: { name: existing.name },
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
