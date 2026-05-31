import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError, error } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

type Params = { params: { id: string } }

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  amount_cents: z.number().int().positive().optional(),
  due_day: z.number().int().min(1).max(31).optional(),
  category_id: z.string().uuid().optional().nullable(),
  cost_center_id: z.string().uuid().optional().nullable(),
  account_id: z.string().uuid().optional().nullable(),
  payment_method: z.string().max(40).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  active: z.boolean().optional(),
})

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const fe = await prisma.fixedExpense.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        categories: { select: { id: true, name: true } },
        cost_centers: { select: { id: true, name: true } },
        accounts_payable: {
          where: { deleted_at: null },
          orderBy: { due_date: 'desc' },
          take: 24,
          select: {
            id: true, description: true, total_amount: true, paid_amount: true,
            due_date: true, status: true, payment_method: true,
          },
        },
      },
    })
    if (!fe) return error('Despesa fixa não encontrada', 404)
    return success(fe)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.fixedExpense.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Despesa fixa não encontrada', 404)

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return error(parsed.error.errors.map((e) => e.message).join('; '), 400)
    }
    const data = parsed.data

    const updateData: Record<string, unknown> = {}
    for (const k of ['name', 'amount_cents', 'due_day', 'category_id', 'cost_center_id', 'account_id', 'payment_method', 'notes', 'active'] as const) {
      if (data[k] !== undefined) updateData[k] = data[k]
    }

    await prisma.fixedExpense.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: updateData,
    })
    const fe = await prisma.fixedExpense.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'fixed_expense.update',
      entityId: params.id,
      oldValue: existing,
      newValue: updateData,
    })

    return success(fe)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.fixedExpense.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Despesa fixa não encontrada', 404)

    // Soft delete (mantém histórico de APs gerados intacto)
    await prisma.fixedExpense.update({
      where: { id: params.id },
      data: { deleted_at: new Date(), active: false },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'fixed_expense.delete',
      entityId: params.id,
      oldValue: { name: existing.name, amount_cents: existing.amount_cents },
    })

    return success({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}
