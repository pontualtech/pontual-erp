'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { useMemo } from 'react'

interface SeriesPoint {
  date: string // YYYY-MM-DD
  inflowCents: number
  outflowCents: number
}

interface Props {
  series: SeriesPoint[]
  inflowTotalCents: number
  outflowTotalCents: number
  loading?: boolean
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cents / 100)
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function FluxoChart({ series, inflowTotalCents, outflowTotalCents, loading }: Props) {
  const data = useMemo(
    () => series.map((s) => ({
      date: shortDate(s.date),
      Entradas: s.inflowCents / 100,
      Saídas: s.outflowCents / 100,
    })),
    [series],
  )

  const netCents = inflowTotalCents - outflowTotalCents
  const netColor = netCents >= 0 ? 'text-emerald-600' : 'text-red-600'

  // Heurística: se período > 31 dias, mostrar tick a cada 7 (semanal)
  const tickStep = data.length > 31 ? Math.ceil(data.length / 8) : 1
  const visibleTicks = data.filter((_, i) => i % tickStep === 0).map((d) => d.date)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Fluxo de caixa</h2>
          <p className="mt-0.5 text-xs text-gray-500">Entradas vs saídas no período</p>
        </div>
        <div className="grid grid-cols-3 gap-x-5 text-right">
          <Stat label="Entradas" value={formatBRL(inflowTotalCents)} tone="text-emerald-600" />
          <Stat label="Saídas" value={formatBRL(outflowTotalCents)} tone="text-red-600" />
          <Stat label="Líquido" value={formatBRL(netCents)} tone={netColor} />
        </div>
      </div>

      <div className="-ml-2 h-64">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">Carregando…</div>
        ) : data.length === 0 || (inflowTotalCents === 0 && outflowTotalCents === 0) ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap={data.length > 31 ? 1 : 4}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                ticks={visibleTicks}
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) =>
                  v === 0 ? '0' : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
                }
                width={48}
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  fontSize: 12,
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
                }}
                formatter={(v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                formatter={(v) => <span className="text-gray-700">{v}</span>}
              />
              <Bar dataKey="Entradas" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Saídas" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <svg className="h-8 w-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 4 5-7" />
      </svg>
      <p className="text-sm text-gray-400">Sem movimentação no período</p>
    </div>
  )
}
