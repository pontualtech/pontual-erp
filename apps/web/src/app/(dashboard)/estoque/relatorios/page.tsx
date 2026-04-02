'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { BarChart3, TrendingUp, DollarSign, AlertTriangle, Loader2, Package } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ABCItem {
  id: string
  name: string
  total_value_cents: number
  percentage: number
  cumulative_percentage: number
  classification: 'A' | 'B' | 'C'
}

interface TurnoverItem {
  id: string
  name: string
  current_stock: number
  total_sold: number
  turnover_rate: number
  unit: string
}

interface ReportSummary {
  total_stock_value_cents: number
  products_below_min: number
  highest_unit_value_product: { name: string; cost_price: number } | null
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function RelatoriosEstoquePage() {
  const [loading, setLoading] = useState(true)
  const [abcData, setAbcData] = useState<ABCItem[]>([])
  const [turnoverData, setTurnoverData] = useState<TurnoverItem[]>([])
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeTab, setActiveTab] = useState<'abc' | 'turnover'>('abc')

  const abcCanvasRef = useRef<HTMLCanvasElement>(null)

  function loadReports() {
    setLoading(true)
    const params = new URLSearchParams()
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)

    Promise.all([
      fetch(`/api/stock/report/abc?${params}`).then(r => r.json()),
      fetch(`/api/stock/report/turnover?${params}`).then(r => r.json()),
      fetch(`/api/stock/report/summary?${params}`).then(r => r.json()),
    ])
      .then(([abcRes, turnoverRes, summaryRes]) => {
        setAbcData(abcRes.data ?? [])
        setTurnoverData(turnoverRes.data ?? [])
        setSummary(summaryRes.data ?? summaryRes)
      })
      .catch(() => toast.error('Erro ao carregar relatórios'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadReports() }, [])

  // Draw ABC Pareto chart on canvas
  useEffect(() => {
    if (!abcCanvasRef.current || abcData.length === 0) return
    const canvas = abcCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const padding = { top: 20, right: 50, bottom: 40, left: 60 }
    const chartW = w - padding.left - padding.right
    const chartH = h - padding.top - padding.bottom

    // Clear
    ctx.clearRect(0, 0, w, h)

    const maxValue = Math.max(...abcData.map(d => d.total_value_cents))
    const barCount = Math.min(abcData.length, 20) // Show top 20
    const barWidth = Math.max(chartW / barCount - 4, 8)

    // Draw bars
    abcData.slice(0, barCount).forEach((item, i) => {
      const barH = (item.total_value_cents / maxValue) * chartH
      const x = padding.left + i * (chartW / barCount) + 2
      const y = padding.top + chartH - barH

      // Color by classification
      ctx.fillStyle = item.classification === 'A' ? '#3b82f6' : item.classification === 'B' ? '#f59e0b' : '#94a3b8'
      ctx.fillRect(x, y, barWidth, barH)
    })

    // Draw cumulative line
    ctx.beginPath()
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2
    abcData.slice(0, barCount).forEach((item, i) => {
      const x = padding.left + i * (chartW / barCount) + barWidth / 2 + 2
      const y = padding.top + chartH - (item.cumulative_percentage / 100) * chartH
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Draw line dots
    abcData.slice(0, barCount).forEach((item, i) => {
      const x = padding.left + i * (chartW / barCount) + barWidth / 2 + 2
      const y = padding.top + chartH - (item.cumulative_percentage / 100) * chartH
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#ef4444'
      ctx.fill()
    })

    // Draw axes
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 1

    // Y-axis left (value)
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top)
    ctx.lineTo(padding.left, padding.top + chartH)
    ctx.stroke()

    // X-axis
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top + chartH)
    ctx.lineTo(padding.left + chartW, padding.top + chartH)
    ctx.stroke()

    // Y-axis right labels (percentage)
    ctx.fillStyle = '#ef4444'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'left'
    ;[0, 25, 50, 75, 100].forEach(pct => {
      const y = padding.top + chartH - (pct / 100) * chartH
      ctx.fillText(`${pct}%`, padding.left + chartW + 4, y + 3)
    })

    // Legend
    const legendY = h - 12
    ctx.font = '11px sans-serif'
    ;[
      { label: 'A', color: '#3b82f6' },
      { label: 'B', color: '#f59e0b' },
      { label: 'C', color: '#94a3b8' },
    ].forEach((leg, i) => {
      const lx = padding.left + i * 60
      ctx.fillStyle = leg.color
      ctx.fillRect(lx, legendY - 8, 12, 12)
      ctx.fillStyle = '#6b7280'
      ctx.fillText(`Classe ${leg.label}`, lx + 16, legendY + 2)
    })

    // Cumulative line legend
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(padding.left + 200, legendY - 2)
    ctx.lineTo(padding.left + 220, legendY - 2)
    ctx.stroke()
    ctx.fillStyle = '#6b7280'
    ctx.fillText('% Acumulado', padding.left + 224, legendY + 2)
  }, [abcData])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Relatórios de Estoque</h1>
        <p className="text-sm text-gray-500">
          <Link href="/produtos" className="text-blue-600 hover:underline">Estoque</Link> / Relatórios
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total em Estoque</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {loading ? '...' : formatCurrency(summary?.total_stock_value_cents ?? 0)}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2.5">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Produtos Abaixo Mínimo</p>
              <p className="mt-1 text-2xl font-bold text-red-600">
                {loading ? '...' : summary?.products_below_min ?? 0}
              </p>
            </div>
            <div className="rounded-lg bg-red-50 p-2.5">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Maior Valor Unitário</p>
              <p className="mt-1 text-lg font-bold text-gray-900">
                {loading ? '...' : summary?.highest_unit_value_product
                  ? `${summary.highest_unit_value_product.name.slice(0, 20)}${summary.highest_unit_value_product.name.length > 20 ? '...' : ''}`
                  : '—'}
              </p>
              {!loading && summary?.highest_unit_value_product && (
                <p className="text-sm text-gray-500">{formatCurrency(summary.highest_unit_value_product.cost_price)}</p>
              )}
            </div>
            <div className="rounded-lg bg-blue-50 p-2.5">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Data Início</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="rounded-md border bg-white px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Data Fim</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="rounded-md border bg-white px-3 py-2 text-sm" />
        </div>
        <button type="button" onClick={loadReports}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Filtrar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-md border bg-white p-0.5 w-fit">
        <button type="button" onClick={() => setActiveTab('abc')}
          className={cn('px-4 py-2 text-sm rounded font-medium transition-colors flex items-center gap-1.5',
            activeTab === 'abc' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100')}>
          <BarChart3 className="h-4 w-4" /> Curva ABC
        </button>
        <button type="button" onClick={() => setActiveTab('turnover')}
          className={cn('px-4 py-2 text-sm rounded font-medium transition-colors flex items-center gap-1.5',
            activeTab === 'turnover' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100')}>
          <TrendingUp className="h-4 w-4" /> Giro de Estoque
        </button>
      </div>

      {/* ABC Curve */}
      {activeTab === 'abc' && (
        <div className="space-y-4">
          {/* Chart */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-3">Curva ABC — Pareto</h3>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : abcData.length === 0 ? (
              <p className="text-gray-400 text-center py-12">Sem dados para exibir</p>
            ) : (
              <canvas ref={abcCanvasRef} className="w-full" style={{ height: '300px' }} />
            )}
          </div>

          {/* Table */}
          <div className="rounded-lg border bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Valor Total</th>
                  <th className="px-4 py-3">% do Total</th>
                  <th className="px-4 py-3">% Acumulado</th>
                  <th className="px-4 py-3">Classe</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
                ) : abcData.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sem dados</td></tr>
                ) : (
                  abcData.map((item, i) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                      <td className="px-4 py-3 text-gray-700">{formatCurrency(item.total_value_cents)}</td>
                      <td className="px-4 py-3 text-gray-500">{item.percentage.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-gray-500">{item.cumulative_percentage.toFixed(1)}%</td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                          item.classification === 'A' ? 'bg-blue-100 text-blue-700' :
                          item.classification === 'B' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        )}>
                          {item.classification}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Turnover */}
      {activeTab === 'turnover' && (
        <div className="rounded-lg border bg-white shadow-sm overflow-x-auto">
          <div className="border-b px-5 py-3">
            <h3 className="font-semibold text-gray-900">Giro de Estoque</h3>
            <p className="text-xs text-gray-400">Quanto maior o giro, mais rápido o produto é vendido e reposto</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Estoque Atual</th>
                <th className="px-4 py-3">Total Vendido</th>
                <th className="px-4 py-3">Giro</th>
                <th className="px-4 py-3">Classificação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
              ) : turnoverData.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sem dados</td></tr>
              ) : (
                turnoverData.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3 text-gray-500">{item.current_stock} {item.unit}</td>
                    <td className="px-4 py-3 text-gray-500">{item.total_sold} {item.unit}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900">{item.turnover_rate.toFixed(2)}x</span>
                    </td>
                    <td className="px-4 py-3">
                      {item.turnover_rate >= 4 ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Alto</span>
                      ) : item.turnover_rate >= 1 ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Médio</span>
                      ) : (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Baixo</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
