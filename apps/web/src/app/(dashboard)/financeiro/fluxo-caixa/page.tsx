'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

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

interface FluxoData {
  data: FluxoItem[]
  totais: {
    entradas: number
    saidas: number
    saldo: number
  }
  saldoBancario: number
  contas: ContaBancaria[]
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatMonthLabel(month: string) {
  const [year, m] = month.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[Number(m) - 1]}/${year.slice(2)}`
}

function CustomTooltip({ active, payload, label }: any) {
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

export default function FluxoCaixaPage() {
  const [data, setData] = useState<FluxoData | null>(null)
  const [loading, setLoading] = useState(true)

  // Default: mês corrente até 11 meses à frente
  const now = new Date()
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1)
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 12, 0)
  const [fromDate, setFromDate] = useState(defaultFrom.toISOString().slice(0, 10))
  const [toDate, setToDate] = useState(defaultTo.toISOString().slice(0, 10))

  const loadData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)

    fetch(`/api/financeiro/relatorios/fluxo-caixa?${params}`)
      .then(r => r.json())
      .then(d => setData(d.data ?? null))
      .catch(() => toast.error('Erro ao carregar fluxo de caixa'))
      .finally(() => setLoading(false))
  }, [fromDate, toDate])

  useEffect(() => { loadData() }, [loadData])

  const chartData = (data?.data ?? []).map(item => ({
    name: formatMonthLabel(item.month),
    Entradas: item.entradas / 100,
    Saidas: item.saidas / 100,
    month: item.month,
  }))

  const totais = data?.totais

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
            <h1 className="text-2xl font-bold text-gray-900">Fluxo de Caixa</h1>
            <p className="text-sm text-gray-500">Entradas e saidas por periodo</p>
          </div>
        </div>
      </div>

      {/* Period Selector */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">De</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ate</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Saldo Bancário */}
      {data && data.contas && data.contas.length > 0 && (
        <div className="rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Saldo Bancario Atual</h2>
            <span className={cn('text-2xl font-bold', (data.saldoBancario ?? 0) >= 0 ? 'text-blue-700' : 'text-red-600')}>
              {formatCurrency(data.saldoBancario ?? 0)}
            </span>
          </div>
          <div className="flex flex-wrap gap-4">
            {data.contas.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">{c.name}:</span>
                <span className={cn('font-medium', c.balance >= 0 ? 'text-blue-700' : 'text-red-600')}>
                  {formatCurrency(c.balance)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {totais && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Entradas</p>
                <p className="mt-1 text-2xl font-bold text-green-600">
                  {loading ? '...' : formatCurrency(totais.entradas)}
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
                <p className="text-sm text-gray-500">Total Saidas</p>
                <p className="mt-1 text-2xl font-bold text-red-600">
                  {loading ? '...' : formatCurrency(totais.saidas)}
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
                <p className="text-sm text-gray-500">Saldo</p>
                <p className={cn(
                  'mt-1 text-2xl font-bold',
                  totais.saldo >= 0 ? 'text-emerald-600' : 'text-red-600'
                )}>
                  {loading ? '...' : formatCurrency(totais.saldo)}
                </p>
              </div>
              <div className={cn(
                'rounded-lg p-2.5',
                totais.saldo >= 0 ? 'bg-emerald-50' : 'bg-red-50'
              )}>
                <DollarSign className={cn('h-5 w-5', totais.saldo >= 0 ? 'text-emerald-600' : 'text-red-600')} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Entradas vs Saidas por Mes</h2>
        {loading ? (
          <div className="flex items-center justify-center h-[350px] text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-[350px] text-gray-400">
            Nenhum dado para o periodo selecionado
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(value: number) =>
                  value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value)
                }
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="Entradas" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Saidas" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Mes</th>
              <th className="px-4 py-3 text-right">Entradas</th>
              <th className="px-4 py-3 text-right">Saidas</th>
              <th className="px-4 py-3 text-right">Saldo</th>
              <th className="px-4 py-3 text-right">Acumulado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando...
                </td>
              </tr>
            ) : (data?.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Nenhum dado para o periodo selecionado
                </td>
              </tr>
            ) : (
              (data?.data ?? []).map(item => (
                <tr key={item.month} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {formatMonthLabel(item.month)}
                  </td>
                  <td className="px-4 py-3 text-right text-green-600 font-medium">
                    {formatCurrency(item.entradas)}
                  </td>
                  <td className="px-4 py-3 text-right text-red-600 font-medium">
                    {formatCurrency(item.saidas)}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right font-medium',
                    item.saldo >= 0 ? 'text-green-600' : 'text-red-600'
                  )}>
                    {formatCurrency(item.saldo)}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right font-semibold',
                    item.acumulado >= 0 ? 'text-emerald-700' : 'text-red-700'
                  )}>
                    {formatCurrency(item.acumulado)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {/* Totals row */}
          {totais && !loading && (data?.data ?? []).length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-gray-50 font-semibold">
                <td className="px-4 py-3 text-gray-900">Total</td>
                <td className="px-4 py-3 text-right text-green-600">
                  {formatCurrency(totais.entradas)}
                </td>
                <td className="px-4 py-3 text-right text-red-600">
                  {formatCurrency(totais.saidas)}
                </td>
                <td className={cn(
                  'px-4 py-3 text-right',
                  totais.saldo >= 0 ? 'text-green-600' : 'text-red-600'
                )}>
                  {formatCurrency(totais.saldo)}
                </td>
                <td className="px-4 py-3 text-right text-gray-400">--</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
