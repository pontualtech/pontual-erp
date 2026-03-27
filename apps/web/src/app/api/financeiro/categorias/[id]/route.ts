import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['RECEITA', 'DESPESA']).optional(),
  parent_id: z.string().nullable().optional(),
})

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const category = await prisma.category.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
        module: { in: ['financeiro_receita', 'financeiro_despesa'] },
      },
      include: {
        categories: { select: { id: true, name: true } },
        other_categories: { select: { id: true, name: true } },
      },
    })

    if (!category) return error('Categoria não encontrada', 404)

    return success({
      ...category,
      type: category.module === 'financeiro_receita' ? 'RECEITA' : 'DESPESA',
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.category.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
        module: { in: ['financeiro_receita', 'financeiro_despesa'] },
      },
    })
    if (!existing) return error('Categoria não encontrada', 404)

    const body = await req.json()
    const data = updateCategorySchema.parse(body)

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.parent_id !== undefined) updateData.parent_id = data.parent_id
    if (data.type !== undefined) {
      updateData.module = data.type === 'RECEITA' ? 'financeiro_receita' : 'financeiro_despesa'
    }

    // Validate parent if provided
    if (data.parent_id) {
      const targetModule = (updateData.module as string) || existing.module
      const parent = await prisma.category.findFirst({
        where: { id: data.parent_id, company_id: user.companyId, module: targetModule },
      })
      if (!parent) return error('Categoria pai não encontrada ou tipo incompatível', 404)
    }

    const category = await prisma.category.update({
      where: { id: params.id },
      data: updateData,
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'category.update',
      entityId: category.id,
      oldValue: { name: existing.name, module: existing.module },
      newValue: updateData as Record<string, unknown>,
    })

    return success({
      ...category,
      type: category.module === 'financeiro_receita' ? 'RECEITA' : 'DESPESA',
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.category.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
        module: { in: ['financeiro_receita', 'financeiro_despesa'] },
      },
    })
    if (!existing) return error('Categoria não encontrada', 404)

    // Check if category is used in accounts_payable
    const usedInPayable = await prisma.accountPayable.count({
      where: { category_id: params.id, company_id: user.companyId },
    })
    if (usedInPayable > 0) {
      return error(`Categoria em uso em ${usedInPayable} conta(s) a pagar. Remova as referências antes de excluir.`, 409)
    }

    // Check if category is used in accounts_receivable
    const usedInReceivable = await prisma.accountReceivable.count({
      where: { category_id: params.id, company_id: user.companyId },
    })
    if (usedInReceivable > 0) {
      return error(`Categoria em uso em ${usedInReceivable} conta(s) a receber. Remova as referências antes de excluir.`, 409)
    }

    await prisma.category.delete({
      where: { id: params.id },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'category.delete',
      entityId: params.id,
      oldValue: { name: existing.name, module: existing.module },
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
