'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts'

interface CategoriaItem {
  name: string
  amount: number
}

interface DREData {
  receita_bruta: number
  receitas: CategoriaItem[]
  deducoes: number
  receita_liquida: number
  custos: number
  custos_detalhado: CategoriaItem[]
  lucro_bruto: number
  despesas_operacionais: number
  despesas_detalhado: CategoriaItem[]
  resultado_operacional: number
  lucro_liquido: number
}

interface MonthlyDRE {
  month: string
  receita_bruta: number
  lucro_bruto: number
  resultado_operacional: number
  lucro_liquido: number
}

interface DREResponse {
  year: number
  month: number | null
  dre: DREData
  monthly: MonthlyDRE[]
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
          {entry.name}: {formatCurrency(entry.value * 100)}
        </p>
      ))}
    </div>
  )
}

function DRELine({
  label,
  value,
  indent = false,
  bold = false,
  separator = false,
  prefix = '',
}: {
  label: string
  value: number
  indent?: boolean
  bold?: boolean
  separator?: boolean
  prefix?: string
}) {
  const isPositive = value >= 0
  return (
    <div
      className={cn(
        'flex items-center justify-between py-2 px-4',
        separator && 'border-t border-gray-200',
        bold && 'font-semibold',
        indent && 'pl-8'
      )}
    >
      <span className={cn('text-sm', indent ? 'text-gray-600' : 'text-gray-900')}>
        {prefix && <span className="text-gray-400 mr-1">{prefix}</span>}
        {label}
      </span>
      <span
        className={cn(
          'text-sm tabular-nums',
          bold ? 'font-bold' : 'font-medium',
          isPositive ? 'text-gray-900' : 'text-red-600'
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
  )
}

function CollapsibleSection({
  title,
  total,
  items,
  prefix = '',
  bold = false,
  separator = false,
}: {
  title: string
  total: number
  items: CategoriaItem[]
  prefix?: string
  bold?: boolean
  separator?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center justify-between w-full py-2 px-4 hover:bg-gray-50 transition-colors',
          separator && 'border-t border-gray-200',
          bold && 'font-semibold'
        )}
      >
        <span className="text-sm text-gray-900 flex items-center gap-1">
          {prefix && <span className="text-gray-400 mr-1">{prefix}</span>}
          {title}
          {items.length > 0 && (
            open ? <ChevronDown className="h-3 w-3 text-gray-400" /> : <ChevronRight className="h-3 w-3 text-gray-400" />
          )}
        </span>
        <span
          className={cn(
            'text-sm tabular-nums',
            bold ? 'font-bold' : 'font-medium',
            total >= 0 ? 'text-gray-900' : 'text-red-600'
          )}
        >
          {formatCurrency(total)}
        </span>
      </button>
      {open && items.length > 0 && (
        <div className="bg-gray-50/50">
          {items.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-4 pl-10">
              <span className="text-xs text-gray-500">{item.name}</span>
              <span className="text-xs text-gray-600 tabular-nums font-medium">
                {formatCurrency(item.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DREPage() {
  const [data, setData] = useState<DREResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState<string>('')

  const loadData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('year', String(year))
    if (month) params.set('month', month)

    fetch(`/api/financeiro/relatorios/dre?${params}`)
      .then(r => r.json())
      .then(d => setData(d.data ?? null))
      .catch(() => toast.error('Erro ao carregar DRE'))
      .finally(() => setLoading(false))
  }, [year, month])

  useEffect(() => { loadData() }, [loadData])

  const dre = data?.dre
  const monthly = data?.monthly ?? []

  const chartData = monthly.map(m => ({
    name: formatMonthLabel(m.month),
    'Receita Bruta': m.receita_bruta / 100,
    'Lucro Bruto': m.lucro_bruto / 100,
    'Lucro Liquido': m.lucro_liquido / 100,
  }))

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)
  const monthOptions = [
    { value: '', label: 'Ano completo' },
    { value: '1', label: 'Janeiro' },
    { value: '2', label: 'Fevereiro' },
    { value: '3', label: 'Marco' },
    { value: '4', label: 'Abril' },
    { value: '5', label: 'Maio' },
    { value: '6', label: 'Junho' },
    { value: '7', label: 'Julho' },
    { value: '8', label: 'Agosto' },
    { value: '9', label: 'Setembro' },
    { value: '10', label: 'Outubro' },
    { value: '11', label: 'Novembro' },
    { value: '12', label: 'Dezembro' },
  ]

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
            <h1 className="text-2xl font-bold text-gray-900">DRE - Demonstrativo de Resultados</h1>
            <p className="text-sm text-gray-500">Analise de receitas, custos e lucro</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ano</label>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
            <select
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 min-w-[160px]"
            >
              {monthOptions.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border bg-white p-12 shadow-sm flex items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando DRE...
        </div>
      ) : !dre ? (
        <div className="rounded-lg border bg-white p-12 shadow-sm text-center text-gray-400">
          Nenhum dado encontrado para o periodo selecionado
        </div>
      ) : (
        <>
          {/* DRE Statement */}
          <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
            <div className="border-b px-4 py-3 bg-gray-50">
              <h2 className="font-semibold text-gray-900">
                Demonstrativo de Resultados do Exercicio
                {data?.month ? ` - ${monthOptions[data.month]?.label}/${data.year}` : ` - ${data?.year}`}
              </h2>
            </div>
            <div className="divide-y divide-gray-100">
              {/* RECEITA BRUTA */}
              <CollapsibleSection
                title="RECEITA BRUTA"
                total={dre.receita_bruta}
                items={dre.receitas}
                bold
              />

              {/* Deducoes */}
              {dre.deducoes > 0 && (
                <DRELine
                  label="DEDUCOES"
                  value={-dre.deducoes}
                  prefix="(-)"
                />
              )}

              {/* Receita Liquida */}
              <DRELine
                label="RECEITA LIQUIDA"
                value={dre.receita_liquida}
                bold
                separator
                prefix="(=)"
              />

              {/* Custos */}
              <CollapsibleSection
                title="CUSTOS DOS SERVICOS/PRODUTOS"
                total={-dre.custos}
                items={dre.custos_detalhado}
                prefix="(-)"
                separator
              />

              {/* Lucro Bruto */}
              <DRELine
                label="LUCRO BRUTO"
                value={dre.lucro_bruto}
                bold
                separator
                prefix="(=)"
              />

              {/* Despesas Operacionais */}
              <CollapsibleSection
                title="DESPESAS OPERACIONAIS"
                total={-dre.despesas_operacionais}
                items={dre.despesas_detalhado}
                prefix="(-)"
                separator
              />

              {/* Resultado Operacional */}
              <DRELine
                label="RESULTADO OPERACIONAL"
                value={dre.resultado_operacional}
                bold
                separator
                prefix="(=)"
              />

              {/* Lucro Liquido */}
              <div
                className={cn(
                  'flex items-center justify-between py-3 px-4 border-t-2',
                  dre.lucro_liquido >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                )}
              >
                <span className="text-sm font-bold text-gray-900">
                  <span className="text-gray-400 mr-1">(=)</span>
                  LUCRO LIQUIDO
                </span>
                <span
                  className={cn(
                    'text-lg font-bold tabular-nums',
                    dre.lucro_liquido >= 0 ? 'text-green-700' : 'text-red-700'
                  )}
                >
                  {formatCurrency(dre.lucro_liquido)}
                </span>
              </div>
            </div>
          </div>

          {/* Monthly Evolution Chart */}
          {chartData.length > 1 && (
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Evolucao Mensal</h2>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value: number) =>
                      value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(Math.round(value))
                    }
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
                  <Line
                    type="monotone"
                    dataKey="Receita Bruta"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Lucro Bruto"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Lucro Liquido"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Monthly Table (for full year) */}
          {monthly.length > 1 && (
            <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-4 py-3">Mes</th>
                    <th className="px-4 py-3 text-right">Receita Bruta</th>
                    <th className="px-4 py-3 text-right">Custos</th>
                    <th className="px-4 py-3 text-right">Lucro Bruto</th>
                    <th className="px-4 py-3 text-right">Despesas</th>
                    <th className="px-4 py-3 text-right">Lucro Liquido</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthly.map(m => (
                    <tr key={m.month} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {formatMonthLabel(m.month)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatCurrency(m.receita_bruta)}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">
                        {formatCurrency(-(m.receita_bruta - m.lucro_bruto))}
                      </td>
                      <td className={cn(
                        'px-4 py-3 text-right font-medium',
                        m.lucro_bruto >= 0 ? 'text-green-600' : 'text-red-600'
                      )}>
                        {formatCurrency(m.lucro_bruto)}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">
                        {formatCurrency(-(m.lucro_bruto - m.resultado_operacional))}
                      </td>
                      <td className={cn(
                        'px-4 py-3 text-right font-semibold',
                        m.lucro_liquido >= 0 ? 'text-green-700' : 'text-red-700'
                      )}>
                        {formatCurrency(m.lucro_liquido)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
