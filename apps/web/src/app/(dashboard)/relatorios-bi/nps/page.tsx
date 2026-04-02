'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie,
} from 'recharts'
import { Download, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDefaultDateRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const to = now.toISOString().split('T')[0]
  return { from, to }
}

function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(';'),
    ...rows.map(r => headers.map(h => {
      const v = r[h]
      return typeof v === 'string' && v.includes(';') ? `"${v}"` : v
    }).join(';')),
  ].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function getNpsLabel(score: number): string {
  if (score >= 75) return 'Excelente'
  if (score >= 50) return 'Muito Bom'
  if (score >= 0) return 'Bom'
  if (score >= -50) return 'Precisa Melhorar'
  return 'Critico'
}

function getNpsColor(score: number): string {
  if (score >= 75) return 'text-green-600'
  if (score >= 50) return 'text-green-500'
  if (score >= 0) return 'text-yellow-500'
  if (score >= -50) return 'text-orange-500'
  return 'text-red-600'
}

function getScoreCategory(score: number): string {
  if (score >= 9) return 'Promotor'
  if (score >= 7) return 'Neutro'
  return 'Detrator'
}

function getScoreBadgeColor(score: number): string {
  if (score >= 9) return 'bg-green-100 text-green-700'
  if (score >= 7) return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}

interface NpsData {
  npsScore: number
  avgScore: number
  total: number
  promoters: number
  passives: number
  detractors: number
  promoterPct: number
  passivePct: number
  detractorPct: number
  scoreDistribution: Array<{ score: number; count: number }>
  recentWithComments: Array<{
    id: string
    score: number
    comment: string
    customerName: string
    osNumber: number
    equipmentType: string
    createdAt: string
  }>
  recentSurveys: Array<{
    id: string
    score: number
    comment: string | null
    customerName: string
    osNumber: number
    equipmentType: string
    createdAt: string
  }>
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function NpsReportPage() {
  const defaults = getDefaultDateRange()
  const [dateFrom, setDateFrom] = useState(defaults.from)
  const [dateTo, setDateTo] = useState(defaults.to)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<NpsData | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ dateFrom, dateTo })
      const res = await fetch(`/api/relatorios/nps?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro')
      setData(json.data)
    } catch (e: any) {
      toast.error(e.message || 'Erro ao carregar relatorio NPS')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  function exportCSV() {
    if (!data) return
    downloadCSV(data.recentSurveys.map(s => ({
      'OS': s.osNumber,
      'Cliente': s.customerName,
      'Equipamento': s.equipmentType,
      'Nota': s.score,
      'Categoria': getScoreCategory(s.score),
      'Comentario': s.comment || '',
      'Data': new Date(s.createdAt).toLocaleDateString('pt-BR'),
    })), 'nps-pesquisas')
  }

  const pieData = data ? [
    { name: 'Promotores (9-10)', value: data.promoters, color: '#22c55e' },
    { name: 'Neutros (7-8)', value: data.passives, color: '#eab308' },
    { name: 'Detratores (0-6)', value: data.detractors, color: '#ef4444' },
  ].filter(d => d.value > 0) : []

  const barColors = Array.from({ length: 11 }, (_, i) => {
    if (i >= 9) return '#22c55e'
    if (i >= 7) return '#eab308'
    return '#ef4444'
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/relatorios-bi"
            className="rounded-md p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-300 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">NPS - Pesquisa de Satisfacao</h1>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
          />
          <span className="text-gray-400">ate</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100"
          />
          {data && data.total > 0 && (
            <button
              type="button"
              onClick={exportCSV}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800 dark:text-gray-100"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!loading && data && data.total === 0 && (
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-12 text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Nenhuma pesquisa NPS</h3>
          <p className="mt-1 text-gray-500 dark:text-gray-400">Nao ha respostas de pesquisa NPS no periodo selecionado.</p>
        </div>
      )}

      {/* Content */}
      {!loading && data && data.total > 0 && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {/* NPS Score - Big */}
            <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm sm:col-span-1">
              <p className="text-sm text-gray-500 dark:text-gray-400">NPS Score</p>
              <p className={cn('mt-1 text-5xl font-bold', getNpsColor(data.npsScore))}>
                {data.npsScore}
              </p>
              <p className={cn('mt-1 text-sm font-medium', getNpsColor(data.npsScore))}>
                {getNpsLabel(data.npsScore)}
              </p>
            </div>

            <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm">
              <p className="text-sm text-gray-500 dark:text-gray-400">Media de Nota</p>
              <p className="mt-1 text-3xl font-bold text-blue-600">{data.avgScore}</p>
              <p className="mt-1 text-xs text-gray-400">{data.total} respostas</p>
            </div>

            <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm">
              <p className="text-sm text-gray-500 dark:text-gray-400">Promotores</p>
              <p className="mt-1 text-3xl font-bold text-green-600">{data.promoterPct}%</p>
              <p className="mt-1 text-xs text-gray-400">{data.promoters} clientes (nota 9-10)</p>
            </div>

            <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6 shadow-sm">
              <p className="text-sm text-gray-500 dark:text-gray-400">Detratores</p>
              <p className="mt-1 text-3xl font-bold text-red-600">{data.detractorPct}%</p>
              <p className="mt-1 text-xs text-gray-400">{data.detractors} clientes (nota 0-6)</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Score Distribution Bar Chart */}
            <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Distribuicao de Notas</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.scoreDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="score" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) => [value, 'Respostas']}
                    labelFormatter={(label: number) => `Nota ${label}`}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.scoreDistribution.map((_, idx) => (
                      <Cell key={idx} fill={barColors[idx]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie Chart */}
            <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Classificacao</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, name: string) => [value, name]} />
                </PieChart>
              </ResponsiveContainer>

              {/* Legend */}
              <div className="mt-4 flex flex-wrap justify-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">Promotores: {data.promoters}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-yellow-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">Neutros: {data.passives}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">Detratores: {data.detractors}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Comments */}
          {data.recentWithComments.length > 0 && (
            <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm">
              <div className="border-b border-gray-100 dark:border-gray-700 px-5 py-4">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">Comentarios Recentes</h3>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.recentWithComments.map(s => (
                  <div key={s.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold',
                            getScoreBadgeColor(s.score)
                          )}>
                            Nota {s.score}
                          </span>
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {s.customerName}
                          </span>
                          <span className="text-xs text-gray-400">
                            OS #{s.osNumber} - {s.equipmentType}
                          </span>
                        </div>
                        <p className="text-gray-600 dark:text-gray-300 text-sm italic">
                          &quot;{s.comment}&quot;
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Recent Surveys Table */}
          <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 dark:border-gray-700 px-5 py-4">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Todas as Pesquisas ({data.total})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">OS</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Cliente</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Equipamento</th>
                    <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Nota</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Categoria</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Comentario</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.recentSurveys.map(s => (
                    <tr key={s.id}>
                      <td className="px-5 py-3 text-sm text-gray-900 dark:text-gray-100 font-medium">
                        #{s.osNumber}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-700 dark:text-gray-300">
                        {s.customerName}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {s.equipmentType}
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold',
                          getScoreBadgeColor(s.score)
                        )}>
                          {s.score}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {getScoreCategory(s.score)}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate">
                        {s.comment || '-'}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500 text-right whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
