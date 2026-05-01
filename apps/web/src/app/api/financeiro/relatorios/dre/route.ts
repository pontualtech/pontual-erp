import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

interface CategoriaItem {
  name: string
  amount: number
}

interface DREMonth {
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

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const year = Number(searchParams.get('year') || new Date().getFullYear())
    const monthParam = searchParams.get('month')

    // Determine date range
    let startDate: Date
    let endDate: Date

    if (monthParam) {
      const month = Number(monthParam)
      startDate = new Date(year, month - 1, 1)
      endDate = new Date(year, month, 0, 23, 59, 59)
    } else {
      startDate = new Date(year, 0, 1)
      endDate = new Date(year, 11, 31, 23, 59, 59)
    }

    const baseWhere = {
      company_id: user.companyId,
      deleted_at: null,
      status: 'PAGO' as const,
      due_date: { gte: startDate, lte: endDate },
    }

    // M4 fix (audit): DRE classifica primeiro via accounts_chart (M-005,
    // Sprint 1) usando match por nome+tipo. Se não houver chart_account
    // mapeado pra categoria, cai pra heurística legacy textual. Reduz erros
    // como "Servico de Manutencao de Mercadoria" classificado como custo
    // por causa do "Mercadoria" no nome.
    //
    // Estratégia: load accounts_chart upfront + name→account_type map. Pra
    // cada AP, tenta match exato do nome da categoria com nome do
    // chart_account ativo. account_type='COGS' → custo, 'OPERATING_EXPENSE'
    // → despesa. Sem match → heurística + reportado em `meta.unclassified[]`.

    // Fetch receivables with categories
    const receivables = await prisma.accountReceivable.findMany({
      where: baseWhere,
      select: {
        total_amount: true,
        received_amount: true,
        due_date: true,
        categories: { select: { id: true, name: true, module: true } },
      },
    })

    // Fetch payables with categories
    const payables = await prisma.accountPayable.findMany({
      where: baseWhere,
      select: {
        total_amount: true,
        paid_amount: true,
        due_date: true,
        categories: { select: { id: true, name: true, module: true } },
      },
    })

    // Pre-load accounts_chart pra classificação (M4)
    const chartAccounts = await prisma.accountChart.findMany({
      where: { company_id: user.companyId, is_active: true },
      select: { name: true, account_type: true, code: true, is_synthetic: true },
    })
    // Map: lower(category_name) → account_type. Inclui synthetic e analítico.
    const chartByName = new Map<string, string>()
    for (const c of chartAccounts) {
      chartByName.set(c.name.toLowerCase().trim(), c.account_type)
    }

    function classifyViaChart(catName: string): string | null {
      const key = catName.toLowerCase().trim()
      // Match exato primeiro
      if (chartByName.has(key)) return chartByName.get(key)!
      // Match parcial (contains) — first match
      for (const [chartName, type] of chartByName) {
        if (key.includes(chartName) || chartName.includes(key)) return type
      }
      return null
    }

    // Group receitas by category
    const receitasMap: Record<string, number> = {}
    let receitaBruta = 0

    for (const r of receivables) {
      const amount = r.received_amount ?? r.total_amount
      const catName = r.categories?.name ?? 'Outros'
      receitasMap[catName] = (receitasMap[catName] || 0) + amount
      receitaBruta += amount
    }

    // Separate payables into custos vs despesas operacionais.
    // Prioridade: chart_account match (M-005) → heurística legacy → fallback despesas
    const custosMap: Record<string, number> = {}
    const despesasMap: Record<string, number> = {}
    let totalCustos = 0
    let totalDespesas = 0
    const unclassified: Array<{ category: string; amount: number; via: 'chart' | 'heuristic' | 'fallback' }> = []

    for (const p of payables) {
      const amount = p.paid_amount ?? p.total_amount
      const catName = p.categories?.name ?? 'Outros'
      const module = p.categories?.module ?? ''

      // 1) Tenta classificar via chart_account (autoritativo)
      const chartType = classifyViaChart(catName)
      let isCusto = false
      let via: 'chart' | 'heuristic' | 'fallback' = 'fallback'
      if (chartType) {
        isCusto = chartType === 'COGS'
        via = 'chart'
      } else {
        // 2) Fallback heurística legacy
        isCusto = module === 'custo' ||
          catName.toLowerCase().includes('custo') ||
          catName.toLowerCase().includes('mercadoria') ||
          catName.toLowerCase().includes('materia') ||
          catName.toLowerCase().includes('insumo')
        via = 'heuristic'
      }

      if (via !== 'chart') {
        unclassified.push({ category: catName, amount, via })
      }

      if (isCusto) {
        custosMap[catName] = (custosMap[catName] || 0) + amount
        totalCustos += amount
      } else {
        despesasMap[catName] = (despesasMap[catName] || 0) + amount
        totalDespesas += amount
      }
    }

    // Build DRE structure
    const deducoes = 0 // Placeholder for tax deductions
    const receitaLiquida = receitaBruta - deducoes
    const lucroBruto = receitaLiquida - totalCustos
    const resultadoOperacional = lucroBruto - totalDespesas
    const lucroLiquido = resultadoOperacional // Simplified (no IR/CSLL)

    // Convert maps to sorted arrays
    const toArray = (map: Record<string, number>): CategoriaItem[] =>
      Object.entries(map)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)

    // Monthly evolution (for chart)
    const monthlyData: DREMonth[] = []
    const startMonth = monthParam ? Number(monthParam) - 1 : 0
    const endMonth = monthParam ? Number(monthParam) - 1 : 11

    for (let m = startMonth; m <= endMonth; m++) {
      const mStart = new Date(year, m, 1)
      const mEnd = new Date(year, m + 1, 0, 23, 59, 59)

      let mReceitaBruta = 0
      let mCustos = 0
      let mDespesas = 0

      for (const r of receivables) {
        const d = new Date(r.due_date)
        if (d >= mStart && d <= mEnd) {
          mReceitaBruta += r.received_amount ?? r.total_amount
        }
      }

      for (const p of payables) {
        const d = new Date(p.due_date)
        if (d >= mStart && d <= mEnd) {
          const amount = p.paid_amount ?? p.total_amount
          const catName = p.categories?.name ?? ''
          const module = p.categories?.module ?? ''

          const isCusto = module === 'custo' ||
            catName.toLowerCase().includes('custo') ||
            catName.toLowerCase().includes('mercadoria') ||
            catName.toLowerCase().includes('materia') ||
            catName.toLowerCase().includes('insumo')

          if (isCusto) {
            mCustos += amount
          } else {
            mDespesas += amount
          }
        }
      }

      const mReceitaLiquida = mReceitaBruta
      const mLucroBruto = mReceitaLiquida - mCustos
      const mResultadoOperacional = mLucroBruto - mDespesas

      monthlyData.push({
        month: `${year}-${String(m + 1).padStart(2, '0')}`,
        receita_bruta: mReceitaBruta,
        deducoes: 0,
        receita_liquida: mReceitaLiquida,
        custos: mCustos,
        lucro_bruto: mLucroBruto,
        despesas_operacionais: mDespesas,
        resultado_operacional: mResultadoOperacional,
        lucro_liquido: mResultadoOperacional,
      })
    }

    return success({
      year,
      month: monthParam ? Number(monthParam) : null,
      dre: {
        receita_bruta: receitaBruta,
        receitas: toArray(receitasMap),
        deducoes,
        receita_liquida: receitaLiquida,
        custos: totalCustos,
        custos_detalhado: toArray(custosMap),
        lucro_bruto: lucroBruto,
        despesas_operacionais: totalDespesas,
        despesas_detalhado: toArray(despesasMap),
        resultado_operacional: resultadoOperacional,
        lucro_liquido: lucroLiquido,
      },
      monthly: monthlyData,
      // M4: meta inclui categorias classificadas via chart vs heurística vs fallback.
      // UI pode mostrar aviso "N categorias usam classificação heurística — mapear no
      // plano de contas pra ganhar precisão".
      meta: {
        classification: {
          via_chart_count: payables.length - unclassified.length,
          via_heuristic_count: unclassified.filter(u => u.via === 'heuristic').length,
          via_fallback_count: unclassified.filter(u => u.via === 'fallback').length,
          unclassified_categories: Array.from(new Set(unclassified.map(u => u.category))),
        },
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
