'use client'

import { useEffect, useState, useCallback } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

type Range = '1h' | '24h' | '7d'

interface HealthResp {
  range: Range
  since: string
  kpis: {
    latest_status: string | null
    latest_at: string | null
    snapshots_in_range: number
    critical_in_range: number
    uptime_pct: number | null
  }
  series: Array<{
    snapshot_at: string
    status: string
    elapsed_ms: number
    data_json: Record<string, any>
  }>
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'text-emerald-400',
  critical: 'text-red-400',
  warning: 'text-amber-400',
}

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('24h')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/health?range=${range}`)
      const json = await res.json()
      if (json.data) setData(json.data)
    } catch {
      // silent — UI mostra estado vazio
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    setLoading(true)
    load()
  }, [range, load])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(load, 30000) // 30s
    return () => clearInterval(id)
  }, [autoRefresh, load])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      </div>
    )
  }

  if (!data) {
    return <p className="text-center text-gray-500 py-20">Sem dados — cron health-monitor pode não ter rodado ainda.</p>
  }

  const k = data.kpis
  const chartData = data.series.map(s => ({
    t: new Date(s.snapshot_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    elapsed_ms: s.elapsed_ms,
    status: s.status,
    db_latency_ms: (s.data_json?.db_latency_ms as number) ?? null,
  }))

  const StatusIcon = k.latest_status === 'ok' ? CheckCircle2 : k.latest_status === 'critical' ? AlertTriangle : Activity
  const statusColor = STATUS_COLORS[k.latest_status || ''] || 'text-gray-400'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <Activity className="h-6 w-6 text-amber-400" />
            Health Monitor
          </h1>
          <p className="text-sm text-gray-500">Série temporal de /api/health — snapshots a cada 5min via cron.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Intervalo de tempo"
            value={range}
            onChange={e => setRange(e.target.value as Range)}
            className="rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200"
          >
            <option value="1h">Última 1h</option>
            <option value="24h">Últimas 24h</option>
            <option value="7d">Últimos 7 dias</option>
          </select>
          <button
            type="button"
            onClick={() => { setLoading(true); load() }}
            className="rounded-md border border-gray-700 bg-gray-900 p-1.5 hover:bg-gray-800"
            title="Recarregar"
          >
            <RefreshCw className="h-4 w-4 text-gray-300" />
          </button>
          <label className="flex items-center gap-1 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh 30s
          </label>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status Atual</p>
            <StatusIcon className={`h-4 w-4 ${statusColor}`} />
          </div>
          <p className={`mt-2 text-2xl font-bold ${statusColor}`}>{k.latest_status || '—'}</p>
          {k.latest_at && (
            <p className="text-xs text-gray-500 mt-1">
              {new Date(k.latest_at).toLocaleString('pt-BR')}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Uptime ({range})</p>
            <Activity className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-100">
            {k.uptime_pct !== null ? `${k.uptime_pct}%` : '—'}
          </p>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Snapshots</p>
            <Clock className="h-4 w-4 text-cyan-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-100">{k.snapshots_in_range}</p>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Críticos</p>
            <AlertTriangle className="h-4 w-4 text-red-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-red-400">{k.critical_in_range}</p>
        </div>
      </div>

      {/* Chart elapsed_ms */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">/api/health latency (ms) — {range}</h2>
        {chartData.length === 0 ? (
          <p className="text-center text-gray-500 py-12">Sem snapshots no período</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="t" stroke="#6b7280" fontSize={11} />
              <YAxis stroke="#6b7280" fontSize={11} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#9ca3af' }}
              />
              <ReferenceLine y={2000} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'SLO 2s', fill: '#ef4444', fontSize: 10 }} />
              <Line type="monotone" dataKey="elapsed_ms" stroke="#fbbf24" strokeWidth={2} dot={false} name="Total" />
              <Line type="monotone" dataKey="db_latency_ms" stroke="#06b6d4" strokeWidth={1} dot={false} name="DB" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Latest snapshot detail */}
      {data.series.length > 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Último snapshot — detalhes</h2>
          <pre className="text-xs text-gray-400 overflow-x-auto bg-gray-950 p-3 rounded">
            {JSON.stringify(data.series[data.series.length - 1]?.data_json, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
