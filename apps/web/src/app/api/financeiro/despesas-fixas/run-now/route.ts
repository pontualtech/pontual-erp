import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

// Feature 2026-05-31 (Karlão): botão "Gerar APs agora" no submodulo.
// Materializa APs do mês corrente APENAS pra empresa do user logado (multi-tenant).
// Mesma lógica de idempotência do cron em /api/internal/cron/generate-fixed-expenses.

function isoDayClamped(year: number, monthIdx: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, monthIdx, Math.min(day, lastDay)))
}

export async function POST(_req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const now = new Date()
    const year = now.getUTCFullYear()
    const monthIdx = now.getUTCMonth()
    const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`
    const firstOfMonth = new Date(Date.UTC(year, monthIdx, 1))

    const active = await prisma.fixedExpense.findMany({
      where: { company_id: user.companyId, active: true, deleted_at: null },
      select: {
        id: true, name: true, amount_cents: true, due_day: true,
        category_id: true, cost_center_id: true, account_id: true, payment_method: true,
        last_generated_at: true,
      },
    })

    let generated = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []

    for (const fe of active) {
      if (fe.last_generated_at) {
        const lastKey = `${fe.last_generated_at.getUTCFullYear()}-${String(fe.last_generated_at.getUTCMonth() + 1).padStart(2, '0')}`
        if (lastKey === monthKey) { skipped++; continue }
      }
      const dueDate = isoDayClamped(year, monthIdx, fe.due_day)
      try {
        await prisma.$transaction([
          prisma.accountPayable.create({
            data: {
              company_id: user.companyId,
              description: fe.name,
              total_amount: fe.amount_cents,
              due_date: dueDate,
              status: 'PENDENTE',
              payment_method: fe.payment_method ?? null,
              account_id: fe.account_id ?? null,
              category_id: fe.category_id ?? null,
              fixed_expense_id: fe.id,
            },
          }),
          prisma.fixedExpense.update({
            where: { id: fe.id },
            data: { last_generated_at: firstOfMonth },
          }),
        ])
        generated++
      } catch (err) {
        failed++
        errors.push(`${fe.name}: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'fixed_expense.run_now',
      newValue: { month: monthKey, generated, skipped, failed },
    })

    return success({ month: monthKey, total_active: active.length, generated, skipped, failed, errors: errors.slice(0, 5) })
  } catch (err) {
    return handleError(err)
  }
}
