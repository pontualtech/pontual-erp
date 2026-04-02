'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BarChart3,
  FileSpreadsheet,
  Loader2,
  Clock,
  Users,
  Truck,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts'

interface TopItem {
  name: string
  amount: number
}

interface AgingItem {
  bracket: string
  customer: string
  description: string
  amount: number
  due_date: string
  days_overdue: number
}

interface AgingSummary {
  current: number
  days30: number
  days60: number
  days90: number
  days90plus: number
}

interface ResumoMensal {
  month: string
  receitas: number
  despesas: number
  resultado: number
}

interface ReportsData {
  aging: {
    summary: AgingSummary
    total: number
    items: AgingItem[]
  }
  topClientes: TopItem[]
  topFornecedores: TopItem[]
  resumoMensal: ResumoMensal[]
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatMonthLabel(month: string) {
  const [year, m] = month.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[Number(m) - 1]}/${year.slice(2)}`
}

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16']

function CustomPieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="rounded-lg border bg-white p-3 shadow-lg text-sm">
      <p className="font-medium text-gray-900">{entry.name}</p>
      <p style={{ color: entry.payload.fill }}>{formatCurrency(entry.value)}</p>
    </div>
  )
}

function CustomBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-white p-3 shadow-lg text-sm">
      <p className="font-medium text-gray-900 mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  )
}

function CollapsibleCard({
  title,
  icon: Icon,
  iconBg,
  iconColor,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: any
  iconBg: string
  iconColor: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={cn('rounded-lg p-2.5', iconBg)}>
            <Icon className={cn('h-5 w-5', iconColor)} />
          </div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
        </div>
        {open ? (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronRight className="h-5 w-5 text-gray-400" />
        )}
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  )
}

export default function RelatoriosPage() {
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const [fromDate, setFromDate] = useState(defaultFrom.toISOString().slice(0, 10))
  const [toDate, setToDate] = useState(defaultTo.toISOString().slice(0, 10))

  const loadData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)

    fetch(`/api/financeiro/relatorios/reports-hub?${params}`)
      .then(r => r.json())
      .then(d => setData(d.data ?? null))
      .catch(() => toast.error('Erro ao carregar relatorios'))
      .finally(() => setLoading(false))
  }, [fromDate, toDate])

  useEffect(() => { loadData() }, [loadData])

  const aging = data?.aging
  const topClientes = data?.topClientes ?? []
  const topFornecedores = data?.topFornecedores ?? []
  const resumoMensal = data?.resumoMensal ?? []

  // Prepare chart data
  const clientePieData = topClientes.map((c, i) => ({
    name: c.name.length > 20 ? c.name.slice(0, 20) + '...' : c.name,
    value: c.amount,
    fill: PIE_COLORS[i % PIE_COLORS.length],
  }))

  const fornecedorPieData = topFornecedores.map((f, i) => ({
    name: f.name.length > 20 ? f.name.slice(0, 20) + '...' : f.name,
    value: f.amount,
    fill: PIE_COLORS[i % PIE_COLORS.length],
  }))

  const resumoChartData = resumoMensal.map(m => ({
    name: formatMonthLabel(m.month),
    Receitas: m.receitas,
    Despesas: m.despesas,
  }))

  const agingBrackets = aging ? [
    { label: 'A vencer', value: aging.summary.current, color: 'bg-green-500' },
    { label: '1-30 dias', value: aging.summary.days30, color: 'bg-yellow-500' },
    { label: '31-60 dias', value: aging.summary.days60, color: 'bg-orange-500' },
    { label: '61-90 dias', value: aging.summary.days90, color: 'bg-red-400' },
    { label: '90+ dias', value: aging.summary.days90plus, color: 'bg-red-600' },
  ] : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/financeiro"
            className="rounded-md border p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Relatorios Financeiros</h1>
            <p className="text-sm text-gray-500">Analise completa de receitas, despesas, clientes e fornecedores</p>
          </div>
        </div>
      </div>

      {/* Date Range Filters */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <CalendarRange className="h-4 w-4 text-gray-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Periodo de Analise</span>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">De</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              title="Data inicial"
              aria-label="Data inicial"
              className="rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ate</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              title="Data final"
              aria-label="Data final"
              className="rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const d = new Date()
                setFromDate(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10))
                setToDate(new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10))
              }}
              className="rounded-md border bg-white py-2 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Este Mes
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date()
                setFromDate(new Date(d.getFullYear(), d.getMonth() - 2, 1).toISOString().slice(0, 10))
                setToDate(new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10))
              }}
              className="rounded-md border bg-white py-2 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Trimestre
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date()
                setFromDate(new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10))
                setToDate(new Date(d.getFullYear(), 11, 31).toISOString().slice(0, 10))
              }}
              className="rounded-md border bg-white py-2 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Ano
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date()
                setFromDate(new Date(d.getFullYear(), d.getMonth() - 11, 1).toISOString().slice(0, 10))
                setToDate(new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10))
              }}
              className="rounded-md border bg-white py-2 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              12 Meses
            </button>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/financeiro/fluxo-caixa"
          className="flex items-start gap-4 rounded-lg border bg-white p-5 shadow-sm hover:border-blue-200 hover:bg-blue-50/50 transition-colors"
        >
          <div className="rounded-lg bg-cyan-50 p-3">
            <BarChart3 className="h-6 w-6 text-cyan-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Fluxo de Caixa</p>
            <p className="text-sm text-gray-500 mt-0.5">
              Entradas e saidas por periodo com filtros por conta e categoria
            </p>
          </div>
        </Link>
        <Link
          href="/financeiro/dre"
          className="flex items-start gap-4 rounded-lg border bg-white p-5 shadow-sm hover:border-blue-200 hover:bg-blue-50/50 transition-colors"
        >
          <div className="rounded-lg bg-indigo-50 p-3">
            <FileSpreadsheet className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">DRE</p>
            <p className="text-sm text-gray-500 mt-0.5">
              Demonstrativo de Resultados com margens e exportacao CSV
            </p>
          </div>
        </Link>
      </div>

      {loading ? (
        <div className="rounded-lg border bg-white p-12 shadow-sm flex items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando relatorios...
        </div>
      ) : (
        <>
          {/* ========== AGING REPORT ========== */}
          <CollapsibleCard
            title="Contas a Receber por Idade (Aging)"
            icon={Clock}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            defaultOpen
          >
            <div className="p-5 space-y-4">
              {/* Aging Summary Bars */}
              <div className="grid grid-cols-5 gap-3">
                {agingBrackets.map(b => (
                  <div key={b.label} className="text-center">
                    <p className="text-xs font-medium text-gray-500 mb-1">{b.label}</p>
                    <p className={cn(
                      'text-lg font-bold tabular-nums',
                      b.value > 0 ? 'text-gray-900' : 'text-gray-300'
                    )}>
                      {formatCurrency(b.value)}
                    </p>
                    <div className="mt-1.5 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', b.color)}
                        style={{
                          width: aging && aging.total > 0
                            ? `${Math.max(2, (b.value / aging.total) * 100)}%`
                            : '0%',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="flex items-center justify-between pt-3 border-t">
                <span className="text-sm font-semibold text-gray-700">Total em Aberto</span>
                <span className={cn(
                  'text-xl font-bold tabular-nums',
                  (aging?.total ?? 0) > 0 ? 'text-amber-600' : 'text-gray-300'
                )}>
                  {formatCurrency(aging?.total ?? 0)}
                </span>
              </div>

              {/* Overdue warning */}
              {aging && (aging.summary.days60 + aging.summary.days90 + aging.summary.days90plus) > 0 && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 p-3">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">
                    <strong>{formatCurrency(aging.summary.days60 + aging.summary.days90 + aging.summary.days90plus)}</strong> em titulos com mais de 60 dias de atraso
                  </p>
                </div>
              )}

              {/* Aging Items Table */}
              {(aging?.items ?? []).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                        <th className="px-3 py-2">Cliente</th>
                        <th className="px-3 py-2">Descricao</th>
                        <th className="px-3 py-2 text-center">Faixa</th>
                        <th className="px-3 py-2 text-center">Dias</th>
                        <th className="px-3 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(aging?.items ?? []).slice(0, 20).map((item, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-900 max-w-[180px] truncate">
                            {item.customer}
                          </td>
                          <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate">
                            {item.description}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={cn(
                              'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                              item.bracket === 'A vencer' ? 'bg-green-100 text-green-700' :
                              item.bracket === '1-30 dias' ? 'bg-yellow-100 text-yellow-700' :
                              item.bracket === '31-60 dias' ? 'bg-orange-100 text-orange-700' :
                              'bg-red-100 text-red-700'
                            )}>
                              {item.bracket}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center text-gray-500 tabular-nums">
                            {item.days_overdue > 0 ? `${item.days_overdue}d` : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900 tabular-nums">
                            {formatCurrency(item.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CollapsibleCard>

          {/* ========== RESUMO MENSAL ========== */}
          <CollapsibleCard
            title="Resumo Mensal - Receitas vs Despesas"
            icon={CalendarRange}
            iconBg="bg-blue-50"
            iconColor="text-blue-600"
            defaultOpen
          >
            <div className="p-5 space-y-4">
              {resumoChartData.length === 0 ? (
                <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
                  Nenhum dado no periodo selecionado
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={resumoChartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value: number) =>
                        value >= 100000 ? `${(value / 100000).toFixed(0)}k` :
                        value >= 1000 ? `${(value / 100).toFixed(0)}` : String(value)
                      }
                    />
                    <Tooltip content={<CustomBarTooltip />} />
                    <Legend />
                    <Bar dataKey="Receitas" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}

              {/* Monthly Table */}
              {resumoMensal.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                        <th className="px-4 py-2">Mes</th>
                        <th className="px-4 py-2 text-right">Receitas</th>
                        <th className="px-4 py-2 text-right">Despesas</th>
                        <th className="px-4 py-2 text-right">Resultado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {resumoMensal.map(m => (
                        <tr key={m.month} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-900">
                            {formatMonthLabel(m.month)}
                          </td>
                          <td className="px-4 py-2 text-right text-green-600 font-medium tabular-nums">
                            {formatCurrency(m.receitas)}
                          </td>
                          <td className="px-4 py-2 text-right text-red-600 font-medium tabular-nums">
                            {formatCurrency(m.despesas)}
                          </td>
                          <td className={cn(
                            'px-4 py-2 text-right font-semibold tabular-nums',
                            m.resultado >= 0 ? 'text-emerald-700' : 'text-red-700'
                          )}>
                            {formatCurrency(m.resultado)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 bg-gray-50 font-semibold">
                        <td className="px-4 py-2 text-gray-900">Total</td>
                        <td className="px-4 py-2 text-right text-green-600 tabular-nums">
                          {formatCurrency(resumoMensal.reduce((s, m) => s + m.receitas, 0))}
                        </td>
                        <td className="px-4 py-2 text-right text-red-600 tabular-nums">
                          {formatCurrency(resumoMensal.reduce((s, m) => s + m.despesas, 0))}
                        </td>
                        <td className={cn(
                          'px-4 py-2 text-right tabular-nums',
                          resumoMensal.reduce((s, m) => s + m.resultado, 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        )}>
                          {formatCurrency(resumoMensal.reduce((s, m) => s + m.resultado, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </CollapsibleCard>

          {/* ========== TOP CLIENTES + TOP FORNECEDORES (side by side) ========== */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Clientes */}
            <CollapsibleCard
              title="Top Clientes (Receita)"
              icon={Users}
              iconBg="bg-green-50"
              iconColor="text-green-600"
              defaultOpen
            >
              <div className="p-5 space-y-4">
                {topClientes.length === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">
                    Nenhum recebimento no periodo
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={clientePieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={45}
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {clientePieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomPieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="divide-y">
                      {topClientes.map((cliente, i) => {
                        const maxAmount = topClientes[0]?.amount ?? 1
                        const percent = maxAmount > 0 ? (cliente.amount / maxAmount) * 100 : 0
                        return (
                          <div key={i} className="py-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                                />
                                <span className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                                  {cliente.name}
                                </span>
                              </div>
                              <span className="text-sm font-semibold text-green-600 tabular-nums">
                                {formatCurrency(cliente.amount)}
                              </span>
                            </div>
                            <div className="ml-5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-green-500 transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </CollapsibleCard>

            {/* Top Fornecedores */}
            <CollapsibleCard
              title="Top Fornecedores (Despesa)"
              icon={Truck}
              iconBg="bg-red-50"
              iconColor="text-red-600"
              defaultOpen
            >
              <div className="p-5 space-y-4">
                {topFornecedores.length === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">
                    Nenhum pagamento no periodo
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={fornecedorPieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          innerRadius={45}
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {fornecedorPieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomPieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="divide-y">
                      {topFornecedores.map((fornecedor, i) => {
                        const maxAmount = topFornecedores[0]?.amount ?? 1
                        const percent = maxAmount > 0 ? (fornecedor.amount / maxAmount) * 100 : 0
                        return (
                          <div key={i} className="py-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                                />
                                <span className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                                  {fornecedor.name}
                                </span>
                              </div>
                              <span className="text-sm font-semibold text-red-600 tabular-nums">
                                {formatCurrency(fornecedor.amount)}
                              </span>
                            </div>
                            <div className="ml-5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-red-500 transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </CollapsibleCard>
          </div>
        </>
      )}
    </div>
  )
}
