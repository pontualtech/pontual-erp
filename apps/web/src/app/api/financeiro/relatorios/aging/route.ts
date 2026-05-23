import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/financeiro/relatorios/aging
 *
 * Aging Report A/R (Sprint UX-15 Onda 5, 2026-05-23) — inspirado em
 * QuickBooks A/R Aging Summary e SAP FBL5N. Lista ARs PENDENTES agrupadas
 * por faixa etária de atraso:
 *
 *   - A vencer (vencimento >= hoje)
 *   - 1-30 dias vencidas
 *   - 31-60 dias vencidas
 *   - 61-90 dias vencidas
 *   - 90+ dias vencidas
 *
 * Cada faixa agregada por cliente. Permite filtro de valor mínimo.
 *
 * Karlão usa pra decidir: ligar 60+? Protestar 90+? Cortar credito?
 */
export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const minValueCents = Number(searchParams.get('min_value') || 0) // centavos

    // Busca todas ARs pendentes do tenant
    const receivables = await prisma.accountReceivable.findMany({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        status: 'PENDENTE',
      },
      include: {
        customers: { select: { id: true, legal_name: true, mobile: true, phone: true, email: true } },
      },
      orderBy: { due_date: 'asc' },
    })

    // Buckets por faixa etária
    type Bucket = {
      label: string
      key: 'future' | '0-30' | '31-60' | '61-90' | '90+'
      total: number
      count: number
      receivables: Array<{
        id: string
        os_id: string | null
        description: string
        customer_id: string | null
        customer_name: string
        customer_phone: string | null
        customer_email: string | null
        total_amount: number
        received_amount: number
        remaining: number
        due_date: string
        days_overdue: number
        charge_status: string | null
      }>
    }

    const buckets: Record<string, Bucket> = {
      future:  { label: 'A vencer',         key: 'future', total: 0, count: 0, receivables: [] },
      '0-30':  { label: '1-30 dias',        key: '0-30',   total: 0, count: 0, receivables: [] },
      '31-60': { label: '31-60 dias',       key: '31-60',  total: 0, count: 0, receivables: [] },
      '61-90': { label: '61-90 dias',       key: '61-90',  total: 0, count: 0, receivables: [] },
      '90+':   { label: '90+ dias',         key: '90+',    total: 0, count: 0, receivables: [] },
    }

    // Calcula Y-M-D de hoje (sem TZ drift, igual fix A1)
    const todayDate = new Date()
    const todayYMD = `${todayDate.getFullYear()}-${String(todayDate.getMonth()+1).padStart(2,'0')}-${String(todayDate.getDate()).padStart(2,'0')}`

    for (const r of receivables) {
      const remaining = r.total_amount - (r.received_amount || 0)
      if (remaining <= 0) continue
      if (remaining < minValueCents) continue

      const dueYMD = r.due_date ? new Date(r.due_date).toISOString().substring(0, 10) : todayYMD
      const daysOverdue = dueYMD >= todayYMD ? 0 : Math.floor((todayDate.getTime() - new Date(dueYMD + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24))

      let bucketKey: keyof typeof buckets
      if (daysOverdue === 0 && dueYMD >= todayYMD) bucketKey = 'future'
      else if (daysOverdue <= 30) bucketKey = '0-30'
      else if (daysOverdue <= 60) bucketKey = '31-60'
      else if (daysOverdue <= 90) bucketKey = '61-90'
      else bucketKey = '90+'

      const b = buckets[bucketKey]
      b.total += remaining
      b.count++
      b.receivables.push({
        id: r.id,
        os_id: r.service_order_id,
        description: r.description,
        customer_id: r.customer_id,
        customer_name: r.customers?.legal_name || '—',
        customer_phone: r.customers?.mobile || r.customers?.phone || null,
        customer_email: r.customers?.email || null,
        total_amount: r.total_amount,
        received_amount: r.received_amount || 0,
        remaining,
        due_date: dueYMD,
        days_overdue: daysOverdue,
        charge_status: r.charge_status,
      })
    }

    // Top 10 clientes inadimplentes (soma de receivables vencidos 1+ dia, agrupado)
    type ClienteAgg = { customer_id: string | null; customer_name: string; customer_phone: string | null; total: number; count: number; worst_days: number }
    const clienteMap = new Map<string, ClienteAgg>()
    const overdueBuckets = ['0-30', '31-60', '61-90', '90+'] as const
    for (const key of overdueBuckets) {
      for (const r of buckets[key].receivables) {
        const cid = r.customer_id || `__no_customer__`
        const cur = clienteMap.get(cid) || { customer_id: r.customer_id, customer_name: r.customer_name, customer_phone: r.customer_phone, total: 0, count: 0, worst_days: 0 }
        cur.total += r.remaining
        cur.count++
        cur.worst_days = Math.max(cur.worst_days, r.days_overdue)
        clienteMap.set(cid, cur)
      }
    }
    const topInadimplentes = Array.from(clienteMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    // Totalizadores
    const totalOverdue = (['0-30', '31-60', '61-90', '90+'] as const)
      .reduce((s, k) => s + buckets[k].total, 0)
    const totalFuture = buckets.future.total
    const grandTotal = totalOverdue + totalFuture

    return success({
      buckets: Object.values(buckets),
      summary: {
        total_future: totalFuture,
        total_overdue: totalOverdue,
        grand_total: grandTotal,
        overdue_count: (['0-30', '31-60', '61-90', '90+'] as const).reduce((s, k) => s + buckets[k].count, 0),
        future_count: buckets.future.count,
      },
      top_inadimplentes: topInadimplentes,
      generated_at: new Date().toISOString(),
    })
  } catch (err) {
    return handleError(err)
  }
}
