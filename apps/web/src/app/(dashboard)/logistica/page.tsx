'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  Truck, Plus, Loader2, ArrowLeft, MapPin, Clock,
  Play, CheckCircle2, Eye, Route, CircleDot, Calendar,
} from 'lucide-react'
import { toast } from 'sonner'

/* ---------- Interfaces ---------- */

interface RouteStop {
  id: string
  sequence: number
  type: string
  status: string
  customer_name: string
  address: string
}

interface LogisticsRoute {
  id: string
  date: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'
  driver_name: string
  driver_avatar?: string | null
  started_at: string | null
  completed_at: string | null
  stops: RouteStop[]
}

interface RouteSummary {
  planned: number
  in_progress: number
  completed: number
  pending_stops: number
}

/* ---------- Helpers ---------- */

function formatTime(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function todayISO() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
  PLANNED: { label: 'Planejada', bg: 'bg-blue-100', text: 'text-blue-700' },
  IN_PROGRESS: { label: 'Em Andamento', bg: 'bg-amber-100', text: 'text-amber-700' },
  COMPLETED: { label: 'Concluida', bg: 'bg-green-100', text: 'text-green-700' },
}

/* ---------- Component ---------- */

export default function LogisticaPage() {
  const [date, setDate] = useState(todayISO())
  const [routes, setRoutes] = useState<LogisticsRoute[]>([])
  const [summary, setSummary] = useState<RouteSummary>({ planned: 0, in_progress: 0, completed: 0, pending_stops: 0 })
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const loadRoutes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/logistics/routes?date=${date}`)
      if (!res.ok) throw new Error('Erro ao carregar rotas')
      const data = await res.json()
      const list: LogisticsRoute[] = data.data ?? []
      setRoutes(list)

      const planned = list.filter(r => r.status === 'PLANNED').length
      const in_progress = list.filter(r => r.status === 'IN_PROGRESS').length
      const completed = list.filter(r => r.status === 'COMPLETED').length
      const pending_stops = list.reduce((acc, r) => {
        return acc + (r.stops?.filter(s => s.status === 'PENDING').length ?? 0)
      }, 0)
      setSummary({ planned, in_progress, completed, pending_stops })
    } catch {
      toast.error('Erro ao carregar rotas')
      setRoutes([])
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { loadRoutes() }, [loadRoutes])

  const handleStartRoute = async (routeId: string) => {
    setActionLoading(routeId)
    try {
      const res = await fetch(`/api/logistics/routes/${routeId}/start`, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success('Rota iniciada')
      loadRoutes()
    } catch {
      toast.error('Erro ao iniciar rota')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCompleteRoute = async (routeId: string) => {
    setActionLoading(routeId)
    try {
      const res = await fetch(`/api/logistics/routes/${routeId}/complete`, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success('Rota concluida')
      loadRoutes()
    } catch {
      toast.error('Erro ao concluir rota')
    } finally {
      setActionLoading(null)
    }
  }

  const summaryCards = [
    { label: 'Rotas Planejadas', value: summary.planned, icon: Route, color: 'text-blue-600 bg-blue-50' },
    { label: 'Em Andamento', value: summary.in_progress, icon: Truck, color: 'text-amber-600 bg-amber-50' },
    { label: 'Concluidas', value: summary.completed, icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
    { label: 'Paradas Pendentes', value: summary.pending_stops, icon: MapPin, color: 'text-purple-600 bg-purple-50' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="rounded-lg border p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Logistica</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="rounded-lg border px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <Link
            href="/logistica/nova"
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova Rota
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin text-gray-300" /> : card.value}
                  </p>
                </div>
                <div className={cn('rounded-xl p-2.5', card.color)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Route List */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">Rotas do Dia</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
          </div>
        ) : routes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Truck className="h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm text-gray-500">Nenhuma rota encontrada para esta data</p>
            <Link
              href="/logistica/nova"
              className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar primeira rota
            </Link>
          </div>
        ) : (
          <div className="divide-y">
            {routes.map(route => {
              const totalStops = route.stops?.length ?? 0
              const completedStops = route.stops?.filter(s => s.status === 'COMPLETED').length ?? 0
              const progress = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0
              const st = statusConfig[route.status] ?? statusConfig.PLANNED
              const isLoading = actionLoading === route.id

              return (
                <div key={route.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  {/* Left: Driver + Status */}
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                      {route.driver_name?.charAt(0)?.toUpperCase() ?? '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 truncate">{route.driver_name}</span>
                        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', st.bg, st.text)}>
                          {st.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-4 text-xs text-gray-400">
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {completedStops}/{totalStops} paradas
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTime(route.started_at)} — {formatTime(route.completed_at)}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 h-1.5 w-full max-w-xs rounded-full bg-gray-100">
                        <div
                          className={cn(
                            'h-1.5 rounded-full transition-all',
                            route.status === 'COMPLETED' ? 'bg-green-500' : 'bg-blue-500'
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/logistica/${route.id}`}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Ver
                    </Link>
                    {route.status === 'PLANNED' && (
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleStartRoute(route.id)}
                        className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                      >
                        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Iniciar
                      </button>
                    )}
                    {route.status === 'IN_PROGRESS' && (
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleCompleteRoute(route.id)}
                        className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Concluir
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
