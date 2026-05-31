import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { success, handleError } from '@/lib/api-response'

// Feature 2026-05-31 (Karlão): Cron que materializa FixedExpense ativa em
// AccountPayable do mês corrente.
//
// Trigger: chamado pelo instrumentation.ts (setInterval diário, ~03:00 BRT).
// Idempotência:
//   1. Filtra FixedExpense.active = true
//   2. Skip se last_generated_at já é do mês corrente (yyyy-mm)
//   3. Cria AP do mês com due_date = clamp(due_day, last_day_of_month)
//   4. Atualiza last_generated_at = primeiro dia do mês corrente
//
// Auth: x-internal-key (padrão dos outros crons internos).

function isoDayClamped(year: number, monthIdx: number, day: number): Date {
  // Último dia do mês (monthIdx é 0-based; Date(year, month+1, 0) volta último dia)
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()
  const safeDay = Math.min(day, lastDay)
  return new Date(Date.UTC(year, monthIdx, safeDay))
}

export async function POST(req: NextRequest) {
  try {
    const internalKey = process.env.INTERNAL_API_KEY
    if (!internalKey || req.headers.get('x-internal-key') !== internalKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const year = now.getUTCFullYear()
    const monthIdx = now.getUTCMonth() // 0-based
    const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}` // ex: "2026-06"
    const firstOfMonth = new Date(Date.UTC(year, monthIdx, 1))

    // Pega todas as despesas fixas ativas de todas as empresas
    const allActive = await prisma.fixedExpense.findMany({
      where: { active: true, deleted_at: null },
      select: {
        id: true, company_id: true, name: true, amount_cents: true, due_day: true,
        category_id: true, cost_center_id: true, account_id: true, payment_method: true,
        last_generated_at: true,
      },
    })

    let generated = 0
    let skipped = 0
    let failed = 0
    const errors: string[] = []

    for (const fe of allActive) {
      // Idempotência: se last_generated_at já é deste mês, pula
      if (fe.last_generated_at) {
        const lastKey = `${fe.last_generated_at.getUTCFullYear()}-${String(fe.last_generated_at.getUTCMonth() + 1).padStart(2, '0')}`
        if (lastKey === monthKey) {
          skipped++
          continue
        }
      }

      const dueDate = isoDayClamped(year, monthIdx, fe.due_day)

      try {
        await prisma.$transaction([
          prisma.accountPayable.create({
            data: {
              company_id: fe.company_id,
              description: fe.name,
              total_amount: fe.amount_cents,
              due_date: dueDate,
              status: 'PENDENTE',
              payment_method: fe.payment_method ?? null,
              account_id: fe.account_id ?? null,
              category_id: fe.category_id ?? null,
              cost_center_id: fe.cost_center_id ?? null,
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

    return success({
      month: monthKey,
      total_active: allActive.length,
      generated,
      skipped,
      failed,
      errors: errors.slice(0, 10),
    })
  } catch (err) {
    return handleError(err)
  }
}
