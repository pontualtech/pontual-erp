import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError, error } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

// Feature 2026-05-31 (Karlão): Despesas Fixas (template) — CRUD.
// Cron mensal /api/internal/cron/generate-fixed-expenses converte cada
// FixedExpense ativa em 1 AccountPayable do mês corrente (idempotente via
// last_generated_at).

const createSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(120),
  amount_cents: z.number().int().positive('Valor deve ser maior que zero'),
  due_day: z.number().int().min(1).max(31),
  category_id: z.string().uuid().optional().nullable(),
  cost_center_id: z.string().uuid().optional().nullable(),
  account_id: z.string().uuid().optional().nullable(),
  payment_method: z.string().max(40).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  active: z.boolean().optional().default(true),
})

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const sp = req.nextUrl.searchParams
    const activeOnly = sp.get('active') === '1'
    const includeStats = sp.get('stats') === '1'

    const items = await prisma.fixedExpense.findMany({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        ...(activeOnly ? { active: true } : {}),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        categories: { select: { id: true, name: true } },
        cost_centers: { select: { id: true, name: true } },
      },
    })

    // Stats: total mensal + anual + count de pagamentos últimos 12m
    if (includeStats) {
      const totalMonthlyCents = items
        .filter((it) => it.active)
        .reduce((s, it) => s + it.amount_cents, 0)
      const totalAnnualCents = totalMonthlyCents * 12

      // Conta APs geradas nos últimos 12 meses por fixed_expense_id
      const twelveMonthsAgo = new Date()
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
      const generatedAPs = await prisma.accountPayable.groupBy({
        by: ['fixed_expense_id'],
        where: {
          company_id: user.companyId,
          deleted_at: null,
          fixed_expense_id: { in: items.map((it) => it.id) },
          due_date: { gte: twelveMonthsAgo },
        },
        _count: true,
        _sum: { paid_amount: true },
      })
      const statsByFe: Record<string, { count: number; paid_total: number }> = {}
      for (const g of generatedAPs) {
        if (g.fixed_expense_id) {
          statsByFe[g.fixed_expense_id] = { count: g._count, paid_total: g._sum.paid_amount ?? 0 }
        }
      }

      return success({
        items: items.map((it) => ({
          ...it,
          stats12m: statsByFe[it.id] ?? { count: 0, paid_total: 0 },
        })),
        summary: {
          total_active: items.filter((it) => it.active).length,
          total_paused: items.filter((it) => !it.active).length,
          monthly_cents: totalMonthlyCents,
          annual_cents: totalAnnualCents,
        },
      })
    }

    return success(items)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return error(parsed.error.errors.map((e) => e.message).join('; '), 400)
    }
    const data = parsed.data

    const fe = await prisma.fixedExpense.create({
      data: {
        company_id: user.companyId,
        name: data.name,
        amount_cents: data.amount_cents,
        due_day: data.due_day,
        category_id: data.category_id ?? null,
        cost_center_id: data.cost_center_id ?? null,
        account_id: data.account_id ?? null,
        payment_method: data.payment_method ?? null,
        notes: data.notes ?? null,
        active: data.active ?? true,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'fixed_expense.create',
      entityId: fe.id,
      newValue: { name: fe.name, amount_cents: fe.amount_cents, due_day: fe.due_day },
    })

    return success(fe, 201)
  } catch (err) {
    return handleError(err)
  }
}
