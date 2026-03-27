import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createCategorySchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  type: z.enum(['RECEITA', 'DESPESA']),
  parent_id: z.string().nullable().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const type = url.get('type') as 'RECEITA' | 'DESPESA' | null

    const where: Record<string, unknown> = {
      company_id: user.companyId,
    }

    // Category type is encoded in the module field: financeiro_receita | financeiro_despesa
    if (type === 'RECEITA') {
      where.module = 'financeiro_receita'
    } else if (type === 'DESPESA') {
      where.module = 'financeiro_despesa'
    } else {
      where.module = { in: ['financeiro_receita', 'financeiro_despesa'] }
    }

    const categories = await prisma.category.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        categories: { select: { id: true, name: true } }, // parent
        other_categories: { select: { id: true, name: true } }, // children
      },
    })

    // Add virtual 'type' field based on module
    const data = categories.map((c) => ({
      ...c,
      type: c.module === 'financeiro_receita' ? 'RECEITA' : 'DESPESA',
    }))

    return success(data)
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
    const data = createCategorySchema.parse(body)

    const module = data.type === 'RECEITA' ? 'financeiro_receita' : 'financeiro_despesa'

    // Validate parent belongs to same company and same type
    if (data.parent_id) {
      const parent = await prisma.category.findFirst({
        where: { id: data.parent_id, company_id: user.companyId, module },
      })
      if (!parent) return error('Categoria pai não encontrada ou tipo incompatível', 404)
    }

    const category = await prisma.category.create({
      data: {
        company_id: user.companyId,
        module,
        name: data.name,
        parent_id: data.parent_id ?? null,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'category.create',
      entityId: category.id,
      newValue: { name: data.name, type: data.type },
    })

    return success({ ...category, type: data.type }, 201)
  } catch (err) {
    return handleError(err)
  }
}
