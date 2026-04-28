import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/financeiro/maquininha/reports
 *
 * Agrega dados das acquirer_transactions pra dashboard.
 *
 * Query params:
 *   from, to: YYYY-MM-DD (default: ultimos 30 dias)
 *   acquirer: 'rede' (default todos)
 *
 * Resposta:
 *   {
 *     period: { from, to },
 *     summary: {
 *       transactions_count,
 *       gross_total,
 *       net_total,
 *       mdr_total,
 *       anticipation_total,
 *       avg_mdr_pct,
 *       avg_anticipation_pct,
 *       avg_total_fee_pct,
 *     },
 *     by_brand: [{ brand, count, gross_total, mdr_total, anticipation_total }],
 *     by_modality: [{ modality, count, gross_total, mdr_total, anticipation_total }],
 *     by_terminal: [{ terminal_code, count, gross_total }],
 *     by_day: [{ date, count, gross_total, mdr_total, anticipation_total }],
 *     match_status: { matched_count, unmatched_count, matched_amount, unmatched_amount }
 *   }
 *
 * Permission: financeiro.view
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const sp = req.nextUrl.searchParams
    let from: Date, to: Date
    if (sp.get('from')) from = new Date(sp.get('from')!)
    else { from = new Date(); from.setDate(from.getDate() - 30); from.setHours(0, 0, 0, 0) }
    if (sp.get('to')) to = new Date(sp.get('to')!)
    else { to = new Date(); to.setHours(23, 59, 59, 999) }
    const acquirer = sp.get('acquirer') || undefined

    const where: any = {
      company_id: user.companyId,
      transaction_date: { gte: from, lte: to },
      status: 'APPROVED',
    }
    if (acquirer) where.acquirer = acquirer

    const txns = await prisma.acquirerTransaction.findMany({
      where,
      select: {
        gross_amount: true,
        net_amount: true,
        mdr_fee_amount: true,
        mdr_fee_percent: true,
        anticipation_fee_amount: true,
        anticipation_fee_percent: true,
        total_fee_amount: true,
        card_brand: true,
        modality: true,
        installments: true,
        terminal_code: true,
        transaction_date: true,
        matched_payment_id: true,
      },
      orderBy: { transaction_date: 'asc' },
    })

    // Summary
    const sum = (k: keyof typeof txns[number]) => txns.reduce((s, t) => s + (Number(t[k]) || 0), 0)
    const grossTotal = sum('gross_amount')
    const mdrTotal = sum('mdr_fee_amount')
    const anticipTotal = sum('anticipation_fee_amount')
    const summary = {
      transactions_count: txns.length,
      gross_total: grossTotal,
      net_total: sum('net_amount'),
      mdr_total: mdrTotal,
      anticipation_total: anticipTotal,
      total_fee: mdrTotal + anticipTotal,
      avg_mdr_pct: txns.length > 0 ? txns.reduce((s, t) => s + t.mdr_fee_percent, 0) / txns.length : 0,
      avg_anticipation_pct: txns.length > 0 ? txns.reduce((s, t) => s + t.anticipation_fee_percent, 0) / txns.length : 0,
      effective_total_pct: grossTotal > 0 ? ((mdrTotal + anticipTotal) / grossTotal) * 100 : 0,
    }

    // Group helpers
    function groupBy<K extends string>(getKey: (t: typeof txns[number]) => K) {
      const m = new Map<K, { count: number; gross_total: number; mdr_total: number; anticipation_total: number }>()
      for (const t of txns) {
        const k = getKey(t)
        const cur = m.get(k) || { count: 0, gross_total: 0, mdr_total: 0, anticipation_total: 0 }
        cur.count++
        cur.gross_total += t.gross_amount
        cur.mdr_total += t.mdr_fee_amount
        cur.anticipation_total += t.anticipation_fee_amount
        m.set(k, cur)
      }
      return Array.from(m.entries()).map(([key, v]) => ({ key, ...v }))
    }

    const byBrand = groupBy(t => t.card_brand || 'sem_bandeira').map(b => ({ brand: b.key, ...b }))
    const byModality = groupBy(t => {
      if (t.modality === 'debit') return 'Debito'
      return `Credito ${t.installments}x`
    }).map(m => ({ modality: m.key, ...m }))
    const byTerminal = groupBy(t => t.terminal_code || 'sem_terminal').map(t => ({ terminal_code: t.key, ...t }))
    const byDay = groupBy(t => t.transaction_date.toISOString().split('T')[0]).map(d => ({ date: d.key, ...d }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Match status
    const matched = txns.filter(t => t.matched_payment_id)
    const unmatched = txns.filter(t => !t.matched_payment_id)
    const matchStatus = {
      matched_count: matched.length,
      unmatched_count: unmatched.length,
      matched_amount: matched.reduce((s, t) => s + t.gross_amount, 0),
      unmatched_amount: unmatched.reduce((s, t) => s + t.gross_amount, 0),
      match_rate: txns.length > 0 ? (matched.length / txns.length) * 100 : 0,
    }

    return success({
      period: { from: from.toISOString(), to: to.toISOString() },
      summary,
      by_brand: byBrand.sort((a, b) => b.gross_total - a.gross_total),
      by_modality: byModality.sort((a, b) => b.gross_total - a.gross_total),
      by_terminal: byTerminal.sort((a, b) => b.gross_total - a.gross_total),
      by_day: byDay,
      match_status: matchStatus,
    })
  } catch (err) {
    return handleError(err)
  }
}
