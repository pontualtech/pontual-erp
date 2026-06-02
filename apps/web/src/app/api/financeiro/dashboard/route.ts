import { NextRequest, NextResponse } from 'next/server'
import { withTenantTx } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

// Redesign 2026-05-30: dashboard estendido com filtros + séries temporais +
// top devedores + deltas vs período anterior. Mantém todos os campos antigos
// (totalBalanceCents, accounts, payable, receivable) — só adiciona novos.
//
// Query params (todos opcionais):
//   from, to        — período ISO YYYY-MM-DD. Default = últimos 30 dias.
//   accountId       — filtra KPIs de período + series por conta bancária
//   categoryId      — filtra KPIs de período + series por categoria
//   costCenterId    — filtra payable por centro de custo
//
// KPIs de saldo (Saldo Total, A Receber/Pagar em aberto) NÃO respeitam período
// — sempre refletem estado atual. Apenas KPIs de fluxo (inflow/outflow) +
// series + deltas usam o período.

// Format YYYY-MM-DD (ISO date sem hora). `endOfDay` é crítico pro `to`:
// sem ele, `lte: '2026-05-31T00:00:00Z'` filtra fora rows com due_date='2026-05-31'
// porque Prisma compara DATE com TIMESTAMP fazendo cast pra midnight UTC.
function parseDateISO(s: string | null, endOfDay = false): Date | null {
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const time = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00Z'
  const d = new Date(`${s}${time}`)
  return Number.isNaN(d.getTime()) ? null : d
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

// Início do dia atual em UTC. Usado pra "vencido" = strictly before today
// (não inclui contas vencendo HOJE — Karlão ainda tem o dia pra pagar).
function startOfTodayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const sp = request.nextUrl.searchParams
    const now = new Date()
    const todayStart = startOfTodayUTC()
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const from = parseDateISO(sp.get('from')) ?? defaultFrom
    const to = parseDateISO(sp.get('to'), true) ?? now
    const accountId = sp.get('accountId') || undefined
    const categoryId = sp.get('categoryId') || undefined
    const costCenterId = sp.get('costCenterId') || undefined
    const paymentMethod = sp.get('paymentMethod') || undefined
    // Busca livre: max 100 chars, sanitização básica. Aplicada via ILIKE em
    // description (AR/AP) e customer.legal_name/trade_name (AR).
    const searchRaw = sp.get('search')?.trim().slice(0, 100) || undefined
    const search = searchRaw ? searchRaw : undefined

    // Valida UUIDs (Postgres ainda escapa via bind, mas isso evita 500 e
    // protege logs contra noise/string esquisita)
    for (const [name, val] of [['accountId', accountId], ['categoryId', categoryId], ['costCenterId', costCenterId]] as const) {
      if (val && !UUID_RE.test(val)) {
        return NextResponse.json({ error: `${name} inválido` }, { status: 400 })
      }
    }

    // Período anterior equivalente pra delta % (ex: período atual = últimos 30d
    // → anterior = 30d antes disso). Bordas: prevTo = from-1ms, prevFrom = prevTo - duração.
    const periodDays = Math.max(1, daysBetween(from, to))
    const prevTo = new Date(from.getTime() - 1)
    const prevFrom = new Date(prevTo.getTime() - periodDays * 24 * 60 * 60 * 1000)

    const basePayable: any = { company_id: user.companyId, deleted_at: null }
    const baseReceivable: any = { company_id: user.companyId, deleted_at: null }
    if (accountId) {
      basePayable.account_id = accountId
      baseReceivable.account_id = accountId
    }
    if (categoryId) {
      basePayable.category_id = categoryId
      baseReceivable.category_id = categoryId
    }
    if (costCenterId) basePayable.cost_center_id = costCenterId
    if (paymentMethod) {
      basePayable.payment_method = paymentMethod
      baseReceivable.payment_method = paymentMethod
    }
    if (search) {
      // Prisma OR — busca em description (AR/AP). Customer name fica restrito
      // a AR via customers relation. Performance OK em ~10k rows; pra >100k,
      // considerar Postgres tsvector.
      basePayable.description = { contains: search, mode: 'insensitive' }
      baseReceivable.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
        { customers: { trade_name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    // A7 fix (audit): wrap em withTenantTx pra strict-ready (M-007).
    const [
      accounts,
      payableOpen,
      payableOverdue,
      receivableOpen,
      receivableOverdue,
      outflowPeriod,
      inflowPeriod,
      outflowPrev,
      inflowPrev,
      topOverdueRaw,
      seriesRaw,
    ] = await withTenantTx(user.companyId, async (tx) => {
      return Promise.all([
        tx.account.findMany({
          where: {
            company_id: user.companyId,
            is_active: true,
            ...(accountId ? { id: accountId } : {}),
          },
          select: { id: true, name: true, account_type: true, current_balance: true },
        }),

        tx.accountPayable.aggregate({
          where: { ...basePayable, status: 'PENDENTE' },
          _sum: { total_amount: true, paid_amount: true },
          _count: true,
        }),

        tx.accountPayable.aggregate({
          where: { ...basePayable, status: 'PENDENTE', due_date: { lt: todayStart } },
          _sum: { total_amount: true, paid_amount: true },
          _count: true,
        }),

        tx.accountReceivable.aggregate({
          where: { ...baseReceivable, status: 'PENDENTE' },
          _sum: { total_amount: true, received_amount: true },
          _count: true,
        }),

        tx.accountReceivable.aggregate({
          where: { ...baseReceivable, status: 'PENDENTE', due_date: { lt: todayStart } },
          _sum: { total_amount: true, received_amount: true },
          _count: true,
        }),

        // Saídas pagas no período. Filtra por `due_date` (não updated_at) pra
        // bater com /relatorios/resumo, /relatorios/reports-hub, /relatorios/fluxo-caixa
        // que são a "fonte da verdade" do financeiro. updated_at quebraria em casos
        // como AR editado depois de pago (mudar descrição), causando deslocamento.
        tx.accountPayable.aggregate({
          where: { ...basePayable, status: 'PAGO', due_date: { gte: from, lte: to } },
          _sum: { paid_amount: true },
          _count: true,
        }),

        // Entradas recebidas no período. Status 'RECEBIDO' é canônico (feedback_ar_status_
        // canonico_recebido) mas projeto aceita ['RECEBIDO','PAGO'] defensivamente pra
        // rows legadas pré-normalização (vide /relatorios/resumo:62, /reports-hub:85).
        tx.accountReceivable.aggregate({
          where: { ...baseReceivable, status: { in: ['RECEBIDO', 'LIQUIDADO', 'PAGO'] }, due_date: { gte: from, lte: to } },
          _sum: { received_amount: true },
          _count: true,
        }),

        // Período anterior pra delta %
        tx.accountPayable.aggregate({
          where: { ...basePayable, status: 'PAGO', due_date: { gte: prevFrom, lte: prevTo } },
          _sum: { paid_amount: true },
        }),
        tx.accountReceivable.aggregate({
          where: { ...baseReceivable, status: { in: ['RECEBIDO', 'LIQUIDADO', 'PAGO'] }, due_date: { gte: prevFrom, lte: prevTo } },
          _sum: { received_amount: true },
        }),

        // Top 5 devedores (ARs vencidos mais antigos com saldo > 0)
        tx.accountReceivable.findMany({
          where: { ...baseReceivable, status: 'PENDENTE', due_date: { lt: todayStart } },
          orderBy: { due_date: 'asc' },
          take: 5,
          select: {
            id: true,
            description: true,
            total_amount: true,
            received_amount: true,
            due_date: true,
            customers: { select: { id: true, legal_name: true, trade_name: true } },
          },
        }),

        // Série temporal diária (Postgres date_trunc por due_date — mesma fonte
        // de verdade dos aggregates acima). UNION pra trazer entrada e saída
        // numa única query, agrupado por dia. Filtros aplicados via bind params
        // (Prisma.$queryRawUnsafe com $1..$N escapa valores; SQL string só tem
        // identificadores hardcoded e o nome da coluna no ${accountId ? ...}).
        tx.$queryRawUnsafe<Array<{ day: Date; kind: string; cents: bigint }>>(
          `
          SELECT day, kind, SUM(cents)::bigint AS cents FROM (
            SELECT date_trunc('day', due_date)::date AS day, 'in' AS kind, COALESCE(received_amount, 0) AS cents
              FROM accounts_receivable
             WHERE company_id = $1 AND deleted_at IS NULL AND status IN ('RECEBIDO', 'LIQUIDADO', 'PAGO')
               AND due_date >= $2 AND due_date <= $3
               ${accountId ? 'AND account_id = $4' : ''}
            UNION ALL
            SELECT date_trunc('day', due_date)::date AS day, 'out' AS kind, COALESCE(paid_amount, 0) AS cents
              FROM accounts_payable
             WHERE company_id = $1 AND deleted_at IS NULL AND status = 'PAGO'
               AND due_date >= $2 AND due_date <= $3
               ${accountId ? 'AND account_id = $4' : ''}
          ) t GROUP BY day, kind ORDER BY day ASC
          `,
          user.companyId,
          from,
          to,
          ...(accountId ? [accountId] : []),
        ),
      ])
    })

    const totalBalanceCents = accounts.reduce((s, a) => s + (a.current_balance ?? 0), 0)

    // Reduce series rows em [{date, inflowCents, outflowCents}]
    const seriesMap = new Map<string, { inflowCents: number; outflowCents: number }>()
    for (const row of seriesRaw) {
      const key = row.day.toISOString().slice(0, 10)
      const cur = seriesMap.get(key) ?? { inflowCents: 0, outflowCents: 0 }
      const cents = Number(row.cents)
      if (row.kind === 'in') cur.inflowCents += cents
      else cur.outflowCents += cents
      seriesMap.set(key, cur)
    }
    // Fill com 0s pros dias sem movimento (chart sem gaps)
    const series: Array<{ date: string; inflowCents: number; outflowCents: number }> = []
    const cursor = new Date(from)
    while (cursor <= to) {
      const key = cursor.toISOString().slice(0, 10)
      series.push({ date: key, ...(seriesMap.get(key) ?? { inflowCents: 0, outflowCents: 0 }) })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }

    const inflowCents = inflowPeriod._sum.received_amount ?? 0
    const outflowCents = outflowPeriod._sum.paid_amount ?? 0
    const inflowPrevCents = inflowPrev._sum.received_amount ?? 0
    const outflowPrevCents = outflowPrev._sum.paid_amount ?? 0

    // Delta %. Quando base = 0, retorna null (UI mostra "—" em vez de Infinity).
    const pct = (cur: number, prev: number) => (prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100)

    return success({
      totalBalanceCents,
      accounts,
      payable: {
        openCents: (payableOpen._sum.total_amount ?? 0) - (payableOpen._sum.paid_amount ?? 0),
        openCount: payableOpen._count,
        overdueCents: (payableOverdue._sum.total_amount ?? 0) - (payableOverdue._sum.paid_amount ?? 0),
        overdueCount: payableOverdue._count,
      },
      receivable: {
        openCents: (receivableOpen._sum.total_amount ?? 0) - (receivableOpen._sum.received_amount ?? 0),
        openCount: receivableOpen._count,
        overdueCents: (receivableOverdue._sum.total_amount ?? 0) - (receivableOverdue._sum.received_amount ?? 0),
        overdueCount: receivableOverdue._count,
      },
      period: {
        fromISO: from.toISOString().slice(0, 10),
        toISO: to.toISOString().slice(0, 10),
        days: periodDays,
      },
      inflow: { cents: inflowCents, count: inflowPeriod._count },
      outflow: { cents: outflowCents, count: outflowPeriod._count },
      deltas: {
        inflowPct: pct(inflowCents, inflowPrevCents),
        outflowPct: pct(outflowCents, outflowPrevCents),
      },
      series,
      topOverdueReceivables: topOverdueRaw.map((r) => ({
        id: r.id,
        description: r.description,
        customerName: r.customers?.trade_name || r.customers?.legal_name || null,
        customerId: r.customers?.id ?? null,
        openCents: r.total_amount - (r.received_amount ?? 0),
        dueDate: r.due_date.toISOString().slice(0, 10),
        daysOverdue: Math.floor((now.getTime() - r.due_date.getTime()) / (1000 * 60 * 60 * 24)),
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
