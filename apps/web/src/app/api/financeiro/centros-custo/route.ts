import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createCostCenterSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  parent_id: z.string().nullable().optional(),
  is_active: z.boolean().optional().default(true),
})

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const costCenters = await prisma.costCenter.findMany({
      where: { company_id: user.companyId },
      orderBy: { name: 'asc' },
      include: {
        cost_centers: { select: { id: true, name: true } }, // parent
        other_cost_centers: { select: { id: true, name: true } }, // children
      },
    })

    return success(costCenters)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const data = createCostCenterSchema.parse(body)

    // Validate parent belongs to same company
    if (data.parent_id) {
      const parent = await prisma.costCenter.findFirst({
        where: { id: data.parent_id, company_id: user.companyId },
      })
      if (!parent) return error('Centro de custo pai não encontrado', 404)
    }

    const costCenter = await prisma.costCenter.create({
      data: {
        company_id: user.companyId,
        name: data.name,
        parent_id: data.parent_id ?? null,
        is_active: data.is_active,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'cost_center.create',
      entityId: costCenter.id,
      newValue: { name: data.name },
    })

    return success(costCenter, 201)
  } catch (err) {
    return handleError(err)
  }
}
