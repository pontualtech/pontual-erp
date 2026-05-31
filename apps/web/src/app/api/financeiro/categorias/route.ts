import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

import { CATEGORY_TYPES, TYPE_TO_MODULE, MODULE_TO_TYPE, ALL_MODULES, type CategoryType } from '@/lib/category-types'

const createCategorySchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  type: z.enum(CATEGORY_TYPES),
  parent_id: z.string().nullable().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const typeParam = url.get('type') as CategoryType | null

    const where: Record<string, unknown> = {
      company_id: user.companyId,
    }

    // Type encodado em module (financeiro_receita/custo/despesa/investimento).
    if (typeParam && TYPE_TO_MODULE[typeParam]) {
      where.module = TYPE_TO_MODULE[typeParam]
    } else {
      where.module = { in: ALL_MODULES }
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
      type: MODULE_TO_TYPE[c.module] || 'DESPESA',
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

    const module = TYPE_TO_MODULE[data.type]

    // Validate parent belongs to same company and same type
    if (data.parent_id) {
      const parent = await prisma.category.findFirst({
        where: { id: data.parent_id, company_id: user.companyId, module },
      })
      if (!parent) return error('Categoria pai não encontrada ou tipo incompatível', 404)
    }

    // Bug #54 (audit 31/05): nome duplicado dentro do mesmo tipo era aceito,
    // gerando 2 categorias "Aluguel" lado a lado na lista. Check case-insensitive.
    const dupCheck = await prisma.category.findFirst({
      where: {
        company_id: user.companyId,
        module,
        name: { equals: data.name.trim(), mode: 'insensitive' },
      },
      select: { id: true, name: true },
    })
    if (dupCheck) {
      return error(`Já existe uma categoria "${dupCheck.name}" deste tipo. Escolha outro nome ou edite a existente.`, 409)
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
