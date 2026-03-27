'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  FileSpreadsheet,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

interface TopItem {
  name: string
  amount: number
}

interface ResumoData {
  periodo: string
  faturamento: number
  despesas: number
  resultado: number
  receivables: { total: number; received: number; count: number }
  payables: { total: number; paid: number; count: number }
  topCategories: TopItem[]
  topClientes: TopItem[]
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

const PIE_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

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

function CustomLegend({ payload }: any) {
  if (!payload?.length) return null
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-1.5 text-xs text-gray-600">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function RelatoriosPage() {
  const [data, setData] = useState<ResumoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [periodo, setPeriodo] = useState('mes')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/financeiro/relatorios/resumo?periodo=${periodo}`)
      .then(r => r.json())
      .then(d => setData(d.data ?? null))
      .catch(() => toast.error('Erro ao carregar resumo'))
      .finally(() => setLoading(false))
  }, [periodo])

  const pieData = (data?.topCategories ?? []).map((cat, i) => ({
    name: cat.name,
    value: cat.amount,
    fill: PIE_COLORS[i % PIE_COLORS.length],
  }))

  const periodoLabel = periodo === 'mes' ? 'do Mes' : periodo === 'trimestre' ? 'do Trimestre' : 'do Ano'

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
            <p className="text-sm text-gray-500">Resumo e analise financeira</p>
          </div>
        </div>
        <div>
          <select
            value={periodo}
            onChange={e => setPeriodo(e.target.value)}
            className="rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="mes">Este Mes</option>
            <option value="trimestre">Trimestre</option>
            <option value="ano">Ano</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Faturamento {periodoLabel}</p>
              <p className="mt-1 text-2xl font-bold text-green-600">
                {loading ? '...' : formatCurrency(data?.faturamento ?? 0)}
              </p>
            </div>
            <div className="rounded-lg bg-green-50 p-2.5">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Despesas {periodoLabel}</p>
              <p className="mt-1 text-2xl font-bold text-red-600">
                {loading ? '...' : formatCurrency(data?.despesas ?? 0)}
              </p>
            </div>
            <div className="rounded-lg bg-red-50 p-2.5">
              <TrendingDown className="h-5 w-5 text-red-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Resultado {periodoLabel}</p>
              <p className={cn(
                'mt-1 text-2xl font-bold',
                (data?.resultado ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
              )}>
                {loading ? '...' : formatCurrency(data?.resultado ?? 0)}
              </p>
            </div>
            <div className={cn(
              'rounded-lg p-2.5',
              (data?.resultado ?? 0) >= 0 ? 'bg-emerald-50' : 'bg-red-50'
            )}>
              <DollarSign className={cn('h-5 w-5', (data?.resultado ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600')} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart - Expenses by Category */}
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Despesas por Categoria</h2>
          {loading ? (
            <div className="flex items-center justify-center h-[300px] text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
            </div>
          ) : pieData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
              Nenhuma despesa no periodo
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="45%"
                  outerRadius={100}
                  innerRadius={50}
                  dataKey="value"
                  paddingAngle={2}
                  label={({ name, percent }: any) =>
                    `${name} (${(percent * 100).toFixed(0)}%)`
                  }
                  labelLine={{ strokeWidth: 1 }}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<CustomPieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Clients */}
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="border-b px-5 py-3">
            <h2 className="font-semibold text-gray-700 text-sm">Top Clientes por Receita</h2>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-[280px] text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : (data?.topClientes ?? []).length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-gray-400 text-sm">
              Nenhum recebimento no periodo
            </div>
          ) : (
            <div className="divide-y">
              {(data?.topClientes ?? []).map((cliente, i) => {
                const maxAmount = data?.topClientes[0]?.amount ?? 1
                const percent = maxAmount > 0 ? (cliente.amount / maxAmount) * 100 : 0
                return (
                  <div key={i} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                          {i + 1}
                        </span>
                        <span className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                          {cliente.name}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-green-600">
                        {formatCurrency(cliente.amount)}
                      </span>
                    </div>
                    <div className="ml-7 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Report Links */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">
          Relatorios Detalhados
        </h2>
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
                Visualize entradas e saidas por periodo, com grafico de barras e tabela detalhada
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
                Demonstrativo de Resultados do Exercicio com receitas, custos, despesas e lucro
              </p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
