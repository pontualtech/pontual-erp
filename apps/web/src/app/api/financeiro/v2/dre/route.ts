import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

interface DreRow {
  fiscal_period: string
  account_type: string
  code: string
  name: string
  total_cents: bigint
}

interface CategoryItem {
  code: string
  name: string
  amount: number
}

interface DREStructure {
  receita_bruta: number
  receitas: CategoryItem[]
  deducoes: number
  receita_liquida: number
  custos: number
  custos_detalhado: CategoryItem[]
  lucro_bruto: number
  despesas_operacionais: number
  despesas_detalhado: CategoryItem[]
  resultado_operacional: number
  impostos: number
  financeiro_liquido: number
  lucro_liquido: number
}

interface MonthlyDREEntry {
  month: string
  receita_bruta: number
  deducoes: number
  receita_liquida: number
  custos: number
  lucro_bruto: number
  despesas_operacionais: number
  resultado_operacional: number
  lucro_liquido: number
}

function aggregateByType(rows: DreRow[]) {
  const byType: Record<string, { total: number; items: CategoryItem[] }> = {}
  for (const r of rows) {
    const key = r.account_type
    if (!byType[key]) byType[key] = { total: 0, items: [] }
    const cents = Number(r.total_cents)
    byType[key].total += cents
    byType[key].items.push({ code: r.code, name: r.name, amount: cents })
  }
  for (const k of Object.keys(byType)) {
    byType[k].items.sort((a, b) => b.amount - a.amount)
  }
  return byType
}

function buildDre(rows: DreRow[]): DREStructure {
  const byType = aggregateByType(rows)
  const receita_bruta = byType.REVENUE?.total ?? 0
  const deducoes = byType.DEDUCTION?.total ?? 0
  const receita_liquida = receita_bruta - deducoes
  const custos = byType.COGS?.total ?? 0
  const lucro_bruto = receita_liquida - custos
  const despesas_operacionais = byType.OPERATING_EXPENSE?.total ?? 0
  const resultado_operacional = lucro_bruto - despesas_operacionais
  const impostos = byType.TAX?.total ?? 0
  const financeiro_liquido = byType.FINANCIAL?.total ?? 0
  const lucro_liquido = resultado_operacional - impostos - financeiro_liquido

  return {
    receita_bruta,
    receitas: byType.REVENUE?.items ?? [],
    deducoes,
    receita_liquida,
    custos,
    custos_detalhado: byType.COGS?.items ?? [],
    lucro_bruto,
    despesas_operacionais,
    despesas_detalhado: byType.OPERATING_EXPENSE?.items ?? [],
    resultado_operacional,
    impostos,
    financeiro_liquido,
    lucro_liquido,
  }
}

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const year = Number(searchParams.get('year') || new Date().getFullYear())
    const monthParam = searchParams.get('month')

    const startMonth = monthParam ? Number(monthParam) : 1
    const endMonth = monthParam ? Number(monthParam) : 12
    const periodFrom = `${year}-${String(startMonth).padStart(2, '0')}`
    const periodTo = `${year}-${String(endMonth).padStart(2, '0')}`

    // Aggregate (period range filter); MV pode estar vazia se backfill ainda não rodou
    const rows = await prisma.$queryRaw<DreRow[]>`
      SELECT fiscal_period, account_type::text AS account_type, code, name, total_cents
        FROM dre_monthly
       WHERE company_id = ${user.companyId}
         AND fiscal_period BETWEEN ${periodFrom} AND ${periodTo}
       ORDER BY fiscal_period, code
    `

    const dre = buildDre(rows)

    // Monthly evolution
    const byMonth: Record<string, DreRow[]> = {}
    for (const r of rows) {
      if (!byMonth[r.fiscal_period]) byMonth[r.fiscal_period] = []
      byMonth[r.fiscal_period].push(r)
    }

    const monthly: MonthlyDREEntry[] = []
    for (let m = startMonth; m <= endMonth; m++) {
      const period = `${year}-${String(m).padStart(2, '0')}`
      const monthRows = byMonth[period] ?? []
      const md = buildDre(monthRows)
      monthly.push({
        month: period,
        receita_bruta: md.receita_bruta,
        deducoes: md.deducoes,
        receita_liquida: md.receita_liquida,
        custos: md.custos,
        lucro_bruto: md.lucro_bruto,
        despesas_operacionais: md.despesas_operacionais,
        resultado_operacional: md.resultado_operacional,
        lucro_liquido: md.lucro_liquido,
      })
    }

    // Estatística da MV
    const stats = await prisma.$queryRaw<{ total_entries: bigint; last_refresh: Date | null }[]>`
      SELECT
        (SELECT COUNT(*) FROM fiscal_entries WHERE company_id = ${user.companyId})::bigint AS total_entries,
        (SELECT GREATEST(MAX(created_at), NULL) FROM fiscal_entries WHERE company_id = ${user.companyId}) AS last_refresh
    `

    return success({
      year,
      month: monthParam ? Number(monthParam) : null,
      engine: 'mv',
      dre,
      monthly,
      meta: {
        total_entries: Number(stats[0]?.total_entries ?? 0),
        last_entry_at: stats[0]?.last_refresh ?? null,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
