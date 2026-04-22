'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toTitleCase as tc } from '@/lib/format-text'
import {
  ArrowLeft, Loader2, Truck, CheckCircle2, XCircle,
  TrendingUp, AlertTriangle, Users, Calendar, Filter,
  ChevronLeft, ChevronRight, Route as RouteIcon, Eye,
} from 'lucide-react'

interface Metrics {
  period: { from: string; to: string }
  totals: {
    total_routes: number
    completed_routes: number
    in_progress_routes: number
    planned_routes: number
    total_stops: number
    completed_stops: number
    failed_stops: number
    success_rate: number
  }
  by_driver: Array<{
    driver_id: string; driver_name: string
    total_stops: number; completed_stops: number; failed_stops: number
    success_rate: number; avg_minutes_per_stop: number | null
  }>
  top_failures: Array<{ reason: string; count: number }>
  trend: Array<{ date: string; completed: number; failed: number }>
  meta?: { agg_truncated: boolean; cap: number }
}

interface HistoryRow {
  id: string
  date: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | null
  started_at: string | null
  completed_at: string | null
  notes: string | null
  driver: { id: string; name: string; phone: string | null; avatar_url: string | null } | null
  total_stops: number
  completed_stops: number
  failed_stops: number
  pending_stops: number
  success_rate: number
  avg_minutes_per_stop: number | null
}

interface DriverChoice { driver_id: string; driver_name: string }

function todayISO() { return new Date().toISOString().slice(0, 10) }
function daysAgoISO(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
function fmtDate(iso: string) {
  try { return new Date(iso + (iso.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('pt-BR') }
  catch { return iso }
}
function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const routeStatusCfg: Record<string, { label: string; bg: string; text: string }> = {
  PLANNED: { label: 'Planejada', bg: 'bg-blue-100', text: 'text-blue-700' },
  IN_PROGRESS: { label: 'Em andamento', bg: 'bg-amber-100', text: 'text-amber-700' },
  COMPLETED: { label: 'Concluida', bg: 'bg-green-100', text: 'text-green-700' },
}

type PresetKey = 'today' | '7d' | '30d' | '90d' | 'custom'
const presets: Array<{ key: PresetKey; label: string; fromDays: number }> = [
  { key: 'today', label: 'Hoje', fromDays: 0 },
  { key: '7d', label: '7 dias', fromDays: 7 },
  { key: '30d', label: '30 dias', fromDays: 30 },
  { key: '90d', label: '90 dias', fromDays: 90 },
]

function StatCard({
  label, value, sub, icon: Icon, color = 'blue',
}: { label: string; value: string | number; sub?: string; icon: any; color?: 'blue' | 'green' | 'red' | 'amber' | 'indigo' }) {
  const colorMap: Record<string, { bg: string; text: string; icon: string }> = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-700', icon: 'text-blue-500' },
    green: { bg: 'bg-green-50', text: 'text-green-700', icon: 'text-green-500' },
    red: { bg: 'bg-red-50', text: 'text-red-700', icon: 'text-red-500' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-500' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', icon: 'text-indigo-500' },
  }
  const c = colorMap[color]
  return (
    <div className={cn('rounded-xl border p-4 shadow-sm', c.bg)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">{label}</p>
          <p className={cn('mt-1 text-2xl font-bold', c.text)}>{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        </div>
        <Icon className={cn('h-6 w-6', c.icon)} />
      </div>
    </div>
  )
}

function TrendChart({ data }: { data: Metrics['trend'] }) {
  const max = useMemo(() => Math.max(1, ...data.map(d => d.completed + d.failed)), [data])
  if (data.length === 0) return <p className="text-sm text-gray-500">Sem dados no periodo.</p>
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map(d => {
        const total = d.completed + d.failed
        const heightPct = total > 0 ? Math.max(6, (total / max) * 100) : 6
        const completedPct = total > 0 ? (d.completed / total) * 100 : 0
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center group min-w-0">
            <div
              className="w-full rounded-t flex flex-col-reverse bg-red-300 overflow-hidden relative"
              style={{ height: `${heightPct}%` }}
              title={`${fmtDate(d.date)}: ${d.completed} ok, ${d.failed} falhou`}
            >
              <div className="bg-green-500 w-full" style={{ height: `${completedPct}%` }} />
            </div>
            <span className="text-[9px] text-gray-500 mt-1 truncate w-full text-center">
              {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function HistoricoPage() {
  const [preset, setPreset] = useState<PresetKey>('30d')
  const [from, setFrom] = useState(daysAgoISO(30))
  const [to, setTo] = useState(todayISO())
  const [driverId, setDriverId] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState('')

  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [rows, setRows] = useState<HistoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [loading, setLoading] = useState(true)

  const [drivers, setDrivers] = useState<DriverChoice[]>([])

  const applyPreset = useCallback((key: PresetKey) => {
    setPreset(key)
    if (key === 'today') { setFrom(todayISO()); setTo(todayISO()) }
    else if (key !== 'custom') {
      const p = presets.find(x => x.key === key)!
      setFrom(daysAgoISO(p.fromDays)); setTo(todayISO())
    }
    setPage(1)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/dashboard/driver-chat', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!cancelled && j?.data?.drivers) {
          setDrivers(j.data.drivers.map((d: any) => ({ driver_id: d.driver_id, driver_name: d.driver_name })))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true)
    try {
      const qs = new URLSearchParams({ from, to })
      if (driverId) qs.set('driver_id', driverId)
      const res = await fetch(`/api/logistics/metrics?${qs.toString()}`, { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      setMetrics(j.data)
    } finally { setMetricsLoading(false) }
  }, [from, to, driverId])

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from, to, page: String(page), limit: String(limit) })
      if (driverId) qs.set('driver_id', driverId)
      if (status) qs.set('status', status)
      if (search.trim()) qs.set('search', search.trim())
      const res = await fetch(`/api/logistics/history?${qs.toString()}`, { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      setRows(j.data || [])
      setTotal(j.meta?.total ?? 0)
    } finally { setLoading(false) }
  }, [from, to, driverId, status, search, page, limit])

  useEffect(() => { loadMetrics() }, [loadMetrics])
  useEffect(() => { loadHistory() }, [loadHistory])

  const pageCount = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/logistica" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Historico de Rotas</h1>
            <p className="text-xs text-gray-500">Dashboard e listagem de todas as rotas.</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Filter className="h-4 w-4" /> Filtros
        </div>

        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button key={p.key} type="button" onClick={() => applyPreset(p.key)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                preset === p.key ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50')}>
              {p.label}
            </button>
          ))}
          <button type="button" onClick={() => setPreset('custom')}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              preset === 'custom' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50')}>
            Personalizado
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs">
            <span className="block text-gray-500 mb-1">De</span>
            <input type="date" value={from}
              onChange={e => { setFrom(e.target.value); setPreset('custom'); setPage(1) }}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block text-gray-500 mb-1">Ate</span>
            <input type="date" value={to}
              onChange={e => { setTo(e.target.value); setPreset('custom'); setPage(1) }}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs">
            <span className="block text-gray-500 mb-1">Motorista</span>
            <select value={driverId} onChange={e => { setDriverId(e.target.value); setPage(1) }}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              {drivers.map(d => (
                <option key={d.driver_id} value={d.driver_id}>{tc(d.driver_name)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block text-gray-500 mb-1">Status</span>
            <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              <option value="PLANNED">Planejada</option>
              <option value="IN_PROGRESS">Em andamento</option>
              <option value="COMPLETED">Concluida</option>
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Rotas" value={metrics?.totals.total_routes ?? '—'}
          sub={metrics ? `${metrics.totals.completed_routes} concluidas` : undefined}
          icon={RouteIcon} color="indigo" />
        <StatCard label="Paradas OK" value={metrics?.totals.completed_stops ?? '—'}
          sub={metrics ? `${metrics.totals.success_rate}% de sucesso` : undefined}
          icon={CheckCircle2} color="green" />
        <StatCard label="Falhas" value={metrics?.totals.failed_stops ?? '—'}
          sub={metrics && metrics.totals.total_stops > 0 ? `${Math.round((metrics.totals.failed_stops / metrics.totals.total_stops) * 100)}% do total` : undefined}
          icon={XCircle} color="red" />
        <StatCard label="Total de paradas" value={metrics?.totals.total_stops ?? '—'}
          sub={metrics ? `${metrics.totals.planned_routes} planejadas` : undefined}
          icon={Truck} color="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-gray-700">Tendencia diaria (paradas)</h2>
          </div>
          {metricsLoading ? (
            <div className="h-32 flex items-center justify-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : metrics ? (
            <>
              <TrendChart data={metrics.trend} />
              <div className="flex items-center gap-4 text-xs text-gray-500 mt-2">
                <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green-500" /> Concluidas</div>
                <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-300" /> Falhas</div>
                {metrics.meta?.agg_truncated && (
                  <span className="ml-auto text-amber-600">Dados truncados em {metrics.meta.cap} paradas.</span>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-gray-700">Motivos de falha</h2>
          </div>
          {metricsLoading ? (
            <div className="h-32 flex items-center justify-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : metrics && metrics.top_failures.length > 0 ? (
            <ul className="space-y-1.5">
              {metrics.top_failures.map((f, idx) => (
                <li key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700 truncate mr-2">{f.reason}</span>
                  <span className="rounded bg-red-100 text-red-700 px-1.5 py-0.5 font-medium">{f.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-500">Sem falhas registradas no periodo.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-gray-700">Produtividade por motorista</h2>
        </div>
        {metricsLoading ? (
          <div className="py-6 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div>
        ) : metrics && metrics.by_driver.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left py-2 px-2">Motorista</th>
                  <th className="text-right py-2 px-2">Paradas</th>
                  <th className="text-right py-2 px-2">OK</th>
                  <th className="text-right py-2 px-2">Falha</th>
                  <th className="text-right py-2 px-2">Sucesso</th>
                  <th className="text-right py-2 px-2">T. medio</th>
                </tr>
              </thead>
              <tbody>
                {metrics.by_driver.map(d => (
                  <tr key={d.driver_id} className="border-t border-gray-100">
                    <td className="py-2 px-2 font-medium text-gray-800">{tc(d.driver_name)}</td>
                    <td className="py-2 px-2 text-right text-gray-700">{d.total_stops}</td>
                    <td className="py-2 px-2 text-right text-green-700">{d.completed_stops}</td>
                    <td className="py-2 px-2 text-right text-red-700">{d.failed_stops}</td>
                    <td className="py-2 px-2 text-right">
                      <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium',
                        d.success_rate >= 90 ? 'bg-green-100 text-green-700' :
                        d.success_rate >= 70 ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700')}>{d.success_rate}%</span>
                    </td>
                    <td className="py-2 px-2 text-right text-gray-600">
                      {d.avg_minutes_per_stop != null ? `${d.avg_minutes_per_stop} min` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-500">Sem paradas atribuidas no periodo.</p>
        )}
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-gray-700">
              Rotas ({total}){total > 0 && ` — pagina ${page}/${pageCount}`}
            </h2>
          </div>
          <div className="flex-1 max-w-xs ml-4">
            <input placeholder="Buscar por motorista ou nota..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm" />
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Nenhuma rota encontrada com os filtros atuais.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left py-2 px-2">Data</th>
                  <th className="text-left py-2 px-2">Motorista</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-right py-2 px-2">Paradas</th>
                  <th className="text-right py-2 px-2">OK / Falha</th>
                  <th className="text-right py-2 px-2">Sucesso</th>
                  <th className="text-right py-2 px-2">Inicio</th>
                  <th className="text-right py-2 px-2">Fim</th>
                  <th className="text-right py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const s = routeStatusCfg[r.status || 'PLANNED'] || routeStatusCfg.PLANNED
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-2 text-gray-800">{fmtDate(r.date)}</td>
                      <td className="py-2 px-2 text-gray-700">{r.driver ? tc(r.driver.name) : <span className="text-gray-400">Sem motorista</span>}</td>
                      <td className="py-2 px-2">
                        <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium', s.bg, s.text)}>{s.label}</span>
                      </td>
                      <td className="py-2 px-2 text-right text-gray-700">{r.total_stops}</td>
                      <td className="py-2 px-2 text-right">
                        <span className="text-green-700">{r.completed_stops}</span>
                        <span className="text-gray-400 mx-0.5">/</span>
                        <span className="text-red-700">{r.failed_stops}</span>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className={cn('inline-block px-2 py-0.5 rounded text-xs font-medium',
                          r.success_rate >= 90 ? 'bg-green-100 text-green-700' :
                          r.success_rate >= 70 ? 'bg-amber-100 text-amber-700' :
                          r.total_stops > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500')}>
                          {r.total_stops > 0 ? `${r.success_rate}%` : '—'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-gray-600">{fmtTime(r.started_at)}</td>
                      <td className="py-2 px-2 text-right text-gray-600">{fmtTime(r.completed_at)}</td>
                      <td className="py-2 px-2 text-right">
                        <Link href={`/logistica/${r.id}`} className="inline-flex items-center gap-1 text-indigo-600 hover:underline text-xs">
                          <Eye className="h-3.5 w-3.5" /> Ver
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button type="button" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 hover:bg-gray-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-gray-600">Pagina {page} de {pageCount}</span>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              className="rounded border border-gray-200 px-2 py-1 text-xs disabled:opacity-50 hover:bg-gray-50">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
