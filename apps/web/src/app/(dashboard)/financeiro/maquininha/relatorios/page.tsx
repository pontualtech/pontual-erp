'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, Loader2, TrendingDown, CreditCard, Zap, AlertCircle } from 'lucide-react'

interface Report {
  period: { from: string; to: string }
  summary: {
    transactions_count: number
    gross_total: number
    net_total: number
    mdr_total: number
    anticipation_total: number
    total_fee: number
    avg_mdr_pct: number
    avg_anticipation_pct: number
    effective_total_pct: number
  }
  by_brand: Array<{ brand: string; count: number; gross_total: number; mdr_total: number; anticipation_total: number }>
  by_modality: Array<{ modality: string; count: number; gross_total: number; mdr_total: number; anticipation_total: number }>
  by_terminal: Array<{ terminal_code: string; count: number; gross_total: number; mdr_total: number; anticipation_total: number }>
  by_day: Array<{ date: string; count: number; gross_total: number; mdr_total: number; anticipation_total: number }>
  match_status: {
    matched_count: number
    unmatched_count: number
    matched_amount: number
    unmatched_amount: number
    match_rate: number
  }
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}
function pct(n: number) { return n.toFixed(2) + '%' }

function defaultRange() {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] }
}

export default function MaquininhaRelatoriosPage() {
  const [range, setRange] = useState(defaultRange())
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/financeiro/maquininha/reports?from=${range.from}&to=${range.to}`)
      const j = await res.json()
      setReport(j.data || null)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [range.from, range.to])

  return (
    <div className="container mx-auto px-6 py-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/financeiro/maquininha" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Relatórios da Maquininha
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Taxas pagas, antecipacao, conciliacao</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
          <span className="text-gray-400">→</span>
          <input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16"><Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" /></div>
      ) : !report ? (
        <p className="text-center text-gray-500 py-16">Sem dados no periodo</p>
      ) : (
        <div className="space-y-6">
          {/* KPIs principais */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-5">
              <p className="text-xs text-gray-500 uppercase font-semibold">Vendas</p>
              <p className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 mt-2">{report.summary.transactions_count}</p>
              <p className="text-sm text-gray-500 mt-1">{fmt(report.summary.gross_total)} bruto</p>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-xl border-2 border-rose-200 dark:border-rose-900 p-5">
              <p className="text-xs text-rose-700 dark:text-rose-400 uppercase font-semibold flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> MDR Pago</p>
              <p className="text-2xl font-extrabold text-rose-700 dark:text-rose-400 mt-2">{fmt(report.summary.mdr_total)}</p>
              <p className="text-xs text-gray-500 mt-1">media {pct(report.summary.avg_mdr_pct)} por venda</p>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-xl border-2 border-amber-200 dark:border-amber-900 p-5">
              <p className="text-xs text-amber-700 dark:text-amber-400 uppercase font-semibold flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Antecipacao (RA)</p>
              <p className="text-2xl font-extrabold text-amber-700 dark:text-amber-400 mt-2">{fmt(report.summary.anticipation_total)}</p>
              <p className="text-xs text-gray-500 mt-1">media {pct(report.summary.avg_anticipation_pct)} por venda</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-gray-900 rounded-xl border-2 border-emerald-200 dark:border-emerald-900 p-5">
              <p className="text-xs text-emerald-700 dark:text-emerald-400 uppercase font-semibold flex items-center gap-1.5"><TrendingDown className="h-3.5 w-3.5" /> Liquido Recebido</p>
              <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 mt-2">{fmt(report.summary.net_total)}</p>
              <p className="text-xs text-gray-500 mt-1">total taxa efetiva: {pct(report.summary.effective_total_pct)}</p>
            </div>
          </div>

          {/* Status conciliacao */}
          <div className={`rounded-xl border-2 p-5 ${report.match_status.unmatched_count > 0 ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800' : 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${report.match_status.unmatched_count > 0 ? 'bg-amber-200 dark:bg-amber-900' : 'bg-emerald-200 dark:bg-emerald-900'}`}>
                {report.match_status.unmatched_count > 0
                  ? <AlertCircle className="h-5 w-5 text-amber-800 dark:text-amber-300" />
                  : <BarChart3 className="h-5 w-5 text-emerald-800 dark:text-emerald-300" />}
              </div>
              <div className="flex-1">
                <p className="font-bold text-gray-900 dark:text-gray-100">
                  Conciliação: {report.match_status.matched_count} de {report.match_status.matched_count + report.match_status.unmatched_count} vinculadas ({pct(report.match_status.match_rate)})
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Vinculadas: {fmt(report.match_status.matched_amount)} • Pendentes: {fmt(report.match_status.unmatched_amount)}
                </p>
              </div>
              {report.match_status.unmatched_count > 0 && (
                <Link href="/financeiro/maquininha"
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold">
                  Conciliar agora
                </Link>
              )}
            </div>
          </div>

          {/* Por bandeira */}
          <Section title="Por Bandeira" rows={report.by_brand.map(b => ({
            label: b.brand.toUpperCase(),
            count: b.count,
            gross: b.gross_total,
            mdr: b.mdr_total,
            ra: b.anticipation_total,
          }))} />

          {/* Por modalidade */}
          <Section title="Por Modalidade (parcelas)" rows={report.by_modality.map(m => ({
            label: m.modality,
            count: m.count,
            gross: m.gross_total,
            mdr: m.mdr_total,
            ra: m.anticipation_total,
          }))} />

          {/* Por maquininha */}
          <Section title="Por Maquininha" rows={report.by_terminal.map(t => ({
            label: t.terminal_code,
            count: t.count,
            gross: t.gross_total,
            mdr: t.mdr_total,
            ra: t.anticipation_total,
          }))} />
        </div>
      )}
    </div>
  )
}

function Section({ title, rows }: {
  title: string
  rows: Array<{ label: string; count: number; gross: number; mdr: number; ra: number }>
}) {
  if (rows.length === 0) return null
  const maxGross = Math.max(...rows.map(r => r.gross), 1)
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <h3 className="px-5 py-4 font-bold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-zinc-700">{title}</h3>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-zinc-800/50 text-xs text-gray-500 uppercase">
          <tr>
            <th className="text-left px-5 py-2">Item</th>
            <th className="text-right px-5 py-2">Vendas</th>
            <th className="text-right px-5 py-2">Bruto</th>
            <th className="text-right px-5 py-2">MDR</th>
            <th className="text-right px-5 py-2">RA</th>
            <th className="text-left px-5 py-2 w-1/3">% do total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
          {rows.map(r => (
            <tr key={r.label}>
              <td className="px-5 py-3 font-mono text-gray-900 dark:text-gray-100">{r.label}</td>
              <td className="px-5 py-3 text-right">{r.count}</td>
              <td className="px-5 py-3 text-right font-mono">{fmt(r.gross)}</td>
              <td className="px-5 py-3 text-right font-mono text-rose-700 dark:text-rose-400">{fmt(r.mdr)}</td>
              <td className="px-5 py-3 text-right font-mono text-amber-700 dark:text-amber-400">{fmt(r.ra)}</td>
              <td className="px-5 py-3">
                <div className="h-2 rounded bg-gray-100 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${(r.gross / maxGross) * 100}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
