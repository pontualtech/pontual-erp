import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/financeiro/dre/pulse
 *
 * Sprint UX-15 Onda 4 (2026-05-23) — DRE Pulse pro Karlão.
 * Responde "estou ganhando dinheiro AGORA?" em 4 KPIs:
 *
 *   1. MTD (mes-to-date): receita - despesa do dia 1 ate hoje
 *   2. Run-rate: projecao fim do mes baseado no MTD
 *   3. MoM (Month-over-Month): mesmo dia util mes passado
 *   4. YoY (Year-over-Year): mesmo periodo ano passado
 *
 * Mais: sparkline 6 meses (lucro liquido por mes).
 *
 * Inspirado em ProfitWell Daily MRR Pulse + Stripe Atlas Overview.
 */
export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() // 0-11
    const day = now.getDate()

    // Helper: soma valores liquidos entre [start, end]
    async function sumPeriod(start: Date, end: Date) {
      const [ar, ap] = await Promise.all([
        prisma.accountReceivable.aggregate({
          where: {
            company_id: user.companyId,
            deleted_at: null,
            status: 'RECEBIDO',
            due_date: { gte: start, lte: end },
          },
          _sum: { received_amount: true, total_amount: true },
        }),
        prisma.accountPayable.aggregate({
          where: {
            company_id: user.companyId,
            deleted_at: null,
            status: 'PAGO',
            due_date: { gte: start, lte: end },
          },
          _sum: { paid_amount: true, total_amount: true },
        }),
      ])
      const receita = ar._sum.received_amount || ar._sum.total_amount || 0
      const despesa = ap._sum.paid_amount || ap._sum.total_amount || 0
      return { receita, despesa, lucro: receita - despesa }
    }

    // 1. MTD (current month, day 1 → today)
    const mtdStart = new Date(year, month, 1, 0, 0, 0)
    const mtdEnd = new Date(year, month, day, 23, 59, 59)
    const mtd = await sumPeriod(mtdStart, mtdEnd)

    // 2. Run-rate: extrapola MTD pra fim do mes
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const runRateReceita = day > 0 ? Math.round((mtd.receita / day) * daysInMonth) : 0
    const runRateDespesa = day > 0 ? Math.round((mtd.despesa / day) * daysInMonth) : 0
    const runRateLucro = runRateReceita - runRateDespesa

    // 3. MoM (Month-over-Month): mesmo periodo mes passado (dia 1 → dia X)
    // Usar Math.min pra evitar overflow (ex: hoje 31/Mai vs Abril que tem 30)
    const lastMonthYear = month === 0 ? year - 1 : year
    const lastMonthIdx = month === 0 ? 11 : month - 1
    const lastMonthDaysInMonth = new Date(lastMonthYear, lastMonthIdx + 1, 0).getDate()
    const lastMonthClampedDay = Math.min(day, lastMonthDaysInMonth)
    const momStart = new Date(lastMonthYear, lastMonthIdx, 1, 0, 0, 0)
    const momEnd = new Date(lastMonthYear, lastMonthIdx, lastMonthClampedDay, 23, 59, 59)
    const mom = await sumPeriod(momStart, momEnd)

    // 4. YoY (Year-over-Year): mesmo periodo ano passado
    const lastYearDaysInMonth = new Date(year - 1, month + 1, 0).getDate()
    const lastYearClampedDay = Math.min(day, lastYearDaysInMonth)
    const yoyStart = new Date(year - 1, month, 1, 0, 0, 0)
    const yoyEnd = new Date(year - 1, month, lastYearClampedDay, 23, 59, 59)
    const yoy = await sumPeriod(yoyStart, yoyEnd)

    // 5. Sparkline 6 meses (lucro liquido por mes — 5 meses passados + atual MTD)
    const sparkline: Array<{ month: string; receita: number; despesa: number; lucro: number; partial: boolean }> = []
    for (let i = 5; i >= 0; i--) {
      const sm = month - i
      const sy = sm < 0 ? year + Math.floor(sm / 12) : year
      const smNorm = ((sm % 12) + 12) % 12
      const isCurrent = i === 0
      const sStart = new Date(sy, smNorm, 1, 0, 0, 0)
      const sEnd = isCurrent
        ? new Date(sy, smNorm, day, 23, 59, 59)
        : new Date(sy, smNorm + 1, 0, 23, 59, 59)
      const s = await sumPeriod(sStart, sEnd)
      const label = `${sy}-${String(smNorm + 1).padStart(2, '0')}`
      sparkline.push({ month: label, receita: s.receita, despesa: s.despesa, lucro: s.lucro, partial: isCurrent })
    }

    // Delta % entre 2 valores (positivo = melhora, null se base 0)
    const pct = (cur: number, base: number) => {
      if (base === 0) return null
      return Math.round(((cur - base) / Math.abs(base)) * 100)
    }

    return success({
      generated_at: now.toISOString(),
      today: now.toISOString().substring(0, 10),
      day_of_month: day,
      days_in_month: daysInMonth,
      mtd: {
        ...mtd,
        period_start: mtdStart.toISOString().substring(0, 10),
        period_end: mtdEnd.toISOString().substring(0, 10),
      },
      run_rate: {
        receita: runRateReceita,
        despesa: runRateDespesa,
        lucro: runRateLucro,
      },
      mom: {
        ...mom,
        period_start: momStart.toISOString().substring(0, 10),
        period_end: momEnd.toISOString().substring(0, 10),
        delta_receita_pct: pct(mtd.receita, mom.receita),
        delta_despesa_pct: pct(mtd.despesa, mom.despesa),
        delta_lucro_pct: pct(mtd.lucro, mom.lucro),
      },
      yoy: {
        ...yoy,
        period_start: yoyStart.toISOString().substring(0, 10),
        period_end: yoyEnd.toISOString().substring(0, 10),
        delta_receita_pct: pct(mtd.receita, yoy.receita),
        delta_despesa_pct: pct(mtd.despesa, yoy.despesa),
        delta_lucro_pct: pct(mtd.lucro, yoy.lucro),
      },
      sparkline,
    })
  } catch (err) {
    return handleError(err)
  }
}
