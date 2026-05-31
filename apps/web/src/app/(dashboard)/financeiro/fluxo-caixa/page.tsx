'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Bar, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { DateInputBR } from '@/app/(dashboard)/components/date-input-br'
import { KPICard } from '@/app/(dashboard)/financeiro/_components/kpi-card'
import { ContasDistribuicao } from '@/app/(dashboard)/financeiro/_components/contas-distribuicao'

interface FluxoItem {
  month: string
  entradas: number
  saidas: number
  saldo: number
  acumulado: number
}

interface ContaBancaria {
  id: string
  name: string
  balance: number
}

interface CategoriaOption {
  id: string
  name: string
  module: string
}

interface FluxoData {
  data: FluxoItem[]
  totais: { entradas: number; saidas: number; saldo: number }
  saldoBancario: number
  contas: ContaBancaria[]
  categorias: CategoriaOption[]
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatMonthLabel(month: string) {
  const [year, m] = month.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[Number(m) - 1]}/${year.slice(2)}`
}

// Tooltip custom: separa "real" (Bar) de "projeção" (Line tracejada) c/ label clara.
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-xs">
      <p className="mb-1.5 font-medium text-gray-900">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="tabular-nums" style={{ color: entry.color }}>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
          {entry.name}: {formatCurrency(entry.value * 100)}
        </p>
      ))}
    </div>
  )
}

const PRESETS: { label: string; months: number; offset?: number }[] = [
  { label: '3 meses',  months: 3 },
  { label: '6 meses',  months: 6 },
  { label: '12 meses', months: 12 },
  { label: 'Ano',      months: 12, offset: -new Date().getMonth() },
]

function presetRange(months: number, offset = 0) {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + offset + months, 0)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export default function FluxoCaixaPage() {
  const [data, setData] = useState<FluxoData | null>(null)
  const [loading, setLoading] = useState(true)

  // Default: mês atual + 11 à frente (12 meses)
  const defaultRange = useMemo(() => presetRange(12), [])
  const [fromDate, setFromDate] = useState(defaultRange.from)
  const [toDate, setToDate] = useState(defaultRange.to)
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const loadData = useCallback(() => {
    const ac = new AbortController()
    setLoading(true)
    const params = new URLSearchParams()
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (accountId) params.set('account_id', accountId)
    if (categoryId) params.set('category_id', categoryId)

    fetch(`/api/financeiro/relatorios/fluxo-caixa?${params}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setData(d.data ?? null))
      .catch((err) => {
        if (err?.name !== 'AbortError') toast.error('Erro ao carregar fluxo de caixa')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [fromDate, toDate, accountId, categoryId])

  useEffect(() => {
    const cleanup = loadData()
    return cleanup
  }, [loadData])

  const rawData = data?.data ?? []
  const todayProj = new Date()
  const currentMonthKey = `${todayProj.getFullYear()}-${String(todayProj.getMonth() + 1).padStart(2, '0')}`

  // W8 (audit 2026-05-23): projeção de fluxo de caixa — padrão ChartMogul/Baremetrics.
  // Linha tracejada de previsão = média dos últimos 3 meses fechados (passado),
  // estendida sobre meses futuros. Karlão vê se vai sobrar caixa.
  const closedMonths = rawData.filter((m) => m.month < currentMonthKey && (m.entradas > 0 || m.saidas > 0))
  const last3 = closedMonths.slice(-3)
  const avgEntradas = last3.length > 0 ? last3.reduce((a, m) => a + m.entradas, 0) / last3.length : 0
  const avgSaidas = last3.length > 0 ? last3.reduce((a, m) => a + m.saidas, 0) / last3.length : 0

  const chartData = rawData.map((item) => {
    const isFuture = item.month >= currentMonthKey
    return {
      name: formatMonthLabel(item.month),
      Entradas: item.entradas / 100,
      Saidas: item.saidas / 100,
      Acumulado: item.acumulado / 100,
      'Entradas (proj)': isFuture && avgEntradas > 0 ? avgEntradas / 100 : null,
      'Saidas (proj)':   isFuture && avgSaidas > 0 ? avgSaidas / 100 : null,
      month: item.month,
    }
  })

  const hasProjection = last3.length >= 2 && chartData.some((c) => c['Entradas (proj)'] != null)
  const totais = data?.totais

  // Sparkline mensal pros KPIs (cada mês = 1 ponto). Em valores R$ (centavos/100).
  const entradasSpark = rawData.map((d) => d.entradas / 100)
  const saidasSpark   = rawData.map((d) => d.saidas / 100)

  // Delta % vs período anterior equivalente (calculado pegando o último mês fechado vs anterior).
  // Aproximação simples — pra cálculo robusto, API precisaria de período anterior.
  const recentClosed = closedMonths.slice(-2)
  const deltaEntradas = recentClosed.length === 2 && recentClosed[0].entradas > 0
    ? ((recentClosed[1].entradas - recentClosed[0].entradas) / recentClosed[0].entradas) * 100
    : null
  const deltaSaidas = recentClosed.length === 2 && recentClosed[0].saidas > 0
    ? ((recentClosed[1].saidas - recentClosed[0].saidas) / recentClosed[0].saidas) * 100
    : null

  const hasFilters = accountId || categoryId || fromDate !== defaultRange.from || toDate !== defaultRange.to

  return (
    <div className="space-y-5">
      {/* Header consistente com /financeiro */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Financeiro</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-gray-900">Fluxo de caixa</h1>
        </div>
      </div>

      {/* Filtros sticky */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-2">
          {/* Presets período */}
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => {
              const r = presetRange(p.months, p.offset ?? 0)
              const active = fromDate === r.from && toDate === r.to
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { setFromDate(r.from); setToDate(r.to) }}
                  className={cn(
                    'h-9 cursor-pointer rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                    active
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
          {/* Custom range */}
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="fc-from" className="mb-1 block text-[11px] text-gray-500">De</label>
              <DateInputBR id="fc-from" value={fromDate} onChange={setFromDate}
                className="h-9 w-32 rounded-md border border-gray-200 bg-white px-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label htmlFor="fc-to" className="mb-1 block text-[11px] text-gray-500">Até</label>
              <DateInputBR id="fc-to" value={toDate} onChange={setToDate}
                className="h-9 w-32 rounded-md border border-gray-200 bg-white px-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none" />
            </div>
          </div>
          {/* Conta */}
          <div>
            <label htmlFor="fc-account" className="mb-1 block text-[11px] text-gray-500">Conta</label>
            <select
              id="fc-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="h-9 min-w-[160px] cursor-pointer rounded-md border border-gray-200 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">Todas as contas</option>
              {(data?.contas ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {/* Categoria */}
          <div>
            <label htmlFor="fc-category" className="mb-1 block text-[11px] text-gray-500">Categoria</label>
            <select
              id="fc-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-9 min-w-[160px] cursor-pointer rounded-md border border-gray-200 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">Todas categorias</option>
              {(data?.categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setAccountId(''); setCategoryId('')
                setFromDate(defaultRange.from); setToDate(defaultRange.to)
              }}
              className="ml-auto h-9 cursor-pointer rounded-md px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KPICard
          label="Total entradas"
          value={formatCurrency(totais?.entradas ?? 0)}
          icon={TrendingUp}
          tone="green"
          sparkline={entradasSpark}
          deltaPct={deltaEntradas}
          loading={loading}
        />
        <KPICard
          label="Total saídas"
          value={formatCurrency(totais?.saidas ?? 0)}
          icon={TrendingDown}
          tone="red"
          sparkline={saidasSpark}
          deltaPct={deltaSaidas}
          deltaInverse
          loading={loading}
        />
        <KPICard
          label="Saldo do período"
          value={formatCurrency(totais?.saldo ?? 0)}
          sub={`${rawData.length} ${rawData.length === 1 ? 'mês' : 'meses'}`}
          icon={Wallet}
          tone={(totais?.saldo ?? 0) >= 0 ? 'green' : 'red'}
          loading={loading}
        />
      </div>

      {/* Saldo Bancário (reusa ContasDistribuicao da Fase 1) */}
      <ContasDistribuicao
        accounts={(data?.contas ?? []).map((c) => ({ id: c.id, name: c.name, current_balance: c.balance }))}
        loading={loading}
      />

      {/* Chart Entradas vs Saídas + Acumulado (Line) + Projeção tracejada */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Entradas vs saídas por mês</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Barras = realizado + projetado · Linha verde = saldo acumulado
              {hasProjection && ` · Tracejado = projeção (média ${last3.length}m)`}
            </p>
          </div>
        </div>
        {loading ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-gray-400">Carregando…</div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-gray-400">
            Nenhum dado para o período selecionado
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) =>
                  v === 0 ? '0' : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
                }
                width={56}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: '#10b981' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) =>
                  v === 0 ? '0' : new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
                }
                width={56}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                formatter={(v) => <span className="text-gray-700">{v}</span>}
              />
              <Bar yAxisId="left" dataKey="Entradas" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="left" dataKey="Saidas"   fill="#ef4444" radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="Acumulado" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
              {hasProjection && (
                <>
                  <Line yAxisId="left" type="monotone" dataKey="Entradas (proj)"
                    stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 2 }} connectNulls={false} />
                  <Line yAxisId="left" type="monotone" dataKey="Saidas (proj)"
                    stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 2 }} connectNulls={false} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {hasProjection && (
          <p className="mt-3 text-[11px] text-gray-400">
            ⓘ Tracejado = projeção baseada na média dos últimos {last3.length} {last3.length === 1 ? 'mês fechado' : 'meses fechados'}. Aproximação — não considera sazonalidade.
          </p>
        )}
      </div>

      {/* Tabela mensal */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500">
              <th className="px-5 py-3">Mês</th>
              <th className="px-5 py-3 text-right">Entradas</th>
              <th className="px-5 py-3 text-right">Saídas</th>
              <th className="px-5 py-3 text-right">Saldo do mês</th>
              <th className="px-5 py-3 text-right">Acumulado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Carregando…</td>
              </tr>
            ) : rawData.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Nenhum dado para o período</td>
              </tr>
            ) : (
              rawData.map((item) => {
                const isFuture = item.month >= currentMonthKey
                return (
                  <tr key={item.month} className={cn('transition-colors hover:bg-gray-50', isFuture && 'bg-blue-50/30')}>
                    <td className="px-5 py-3 font-medium text-gray-900 tabular-nums">
                      {formatMonthLabel(item.month)}
                      {isFuture && <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-blue-500">Projetado</span>}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-emerald-600 tabular-nums">{formatCurrency(item.entradas)}</td>
                    <td className="px-5 py-3 text-right font-medium text-red-600 tabular-nums">{formatCurrency(item.saidas)}</td>
                    <td className={cn('px-5 py-3 text-right font-medium tabular-nums', item.saldo >= 0 ? 'text-gray-900' : 'text-red-600')}>
                      {formatCurrency(item.saldo)}
                    </td>
                    <td className={cn('px-5 py-3 text-right font-semibold tabular-nums', item.acumulado >= 0 ? 'text-sky-600' : 'text-red-700')}>
                      {formatCurrency(item.acumulado)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
          {totais && !loading && rawData.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50/80 text-sm font-semibold">
                <td className="px-5 py-3 text-gray-900">Total</td>
                <td className="px-5 py-3 text-right text-emerald-600 tabular-nums">{formatCurrency(totais.entradas)}</td>
                <td className="px-5 py-3 text-right text-red-600 tabular-nums">{formatCurrency(totais.saidas)}</td>
                <td className={cn('px-5 py-3 text-right tabular-nums', totais.saldo >= 0 ? 'text-gray-900' : 'text-red-600')}>
                  {formatCurrency(totais.saldo)}
                </td>
                <td className="px-5 py-3 text-right text-gray-400">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
