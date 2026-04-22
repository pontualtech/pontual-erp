'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toTitleCase as tc } from '@/lib/format-text'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRightLeft, Loader2, Calendar, Package, Truck,
  User, MapPin, CheckCircle2, XCircle, Clock, ChevronRight,
} from 'lucide-react'

interface RouteStop {
  id: string
  sequence: number
  type: 'COLETA' | 'ENTREGA' | string
  status: string | null
  customer_name: string | null
  address: string
  os_id: string | null
  os_number: number | null
}

interface RouteInfo {
  id: string
  status: string | null
  driver: { id: string; name: string } | null
  total_stops: number | null
  completed_stops: number | null
  stops: RouteStop[]
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

export default function RedistribuirPage() {
  const [date, setDate] = useState(todayISO())
  const [routes, setRoutes] = useState<RouteInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [moving, setMoving] = useState<string | null>(null)
  const [moveModal, setMoveModal] = useState<{ stopId: string; currentRouteId: string; customerName: string } | null>(null)

  const loadRoutes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/logistics/routes?date=${date}&limit=50`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const j = await res.json()
      const list = (j.data || []).map((r: any) => ({
        id: r.id,
        status: r.status,
        driver: r.driver ? { id: r.driver.id, name: r.driver.name } : null,
        total_stops: r.total_stops,
        completed_stops: r.completed_stops,
        stops: [],
      }))

      // Paralelo: busca stops de cada rota via /api/logistics/routes/[id]
      const full = await Promise.all(list.map(async (r: RouteInfo) => {
        try {
          const d = await fetch(`/api/logistics/routes/${r.id}`, { cache: 'no-store' })
          if (!d.ok) return r
          const dj = await d.json()
          return { ...r, stops: (dj.data?.stops || []).map((s: any) => ({
            id: s.id, sequence: s.sequence, type: s.type, status: s.status,
            customer_name: s.customer_name,
            address: s.address || '',
            os_id: s.os_id, os_number: s.os_number,
          })) }
        } catch { return r }
      }))
      setRoutes(full)
    } catch {
      toast.error('Falha ao carregar rotas')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { loadRoutes() }, [loadRoutes])

  async function moveStop(stopId: string, newRouteId: string) {
    setMoving(stopId)
    try {
      const res = await fetch(`/api/logistics/stops/${stopId}/reassign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_id: newRouteId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j?.error || 'Falha ao mover')
        return
      }
      toast.success('Parada movida')
      setMoveModal(null)
      loadRoutes()
    } catch {
      toast.error('Falha de rede')
    } finally {
      setMoving(null)
    }
  }

  const targetRoutes = useMemo(() => {
    if (!moveModal) return []
    return routes.filter(r => r.id !== moveModal.currentRouteId)
  }, [moveModal, routes])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/logistica" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-indigo-600" />
              Redistribuir Paradas
            </h1>
            <p className="text-xs text-gray-500">Mova paradas pendentes entre motoristas do mesmo dia.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : routes.length === 0 ? (
        <div className="text-center py-16 text-sm text-gray-500">Nenhuma rota nesse dia.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {routes.map(route => {
            const pending = route.stops.filter(s => s.status !== 'COMPLETED' && s.status !== 'FAILED')
            const done = route.stops.filter(s => s.status === 'COMPLETED')
            const failed = route.stops.filter(s => s.status === 'FAILED')
            return (
              <div key={route.id} className="rounded-xl border bg-white shadow-sm flex flex-col">
                <div className="border-b px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm text-gray-900 truncate">
                          {route.driver ? tc(route.driver.name) : 'Sem motorista'}
                        </h3>
                        <p className="text-[11px] text-gray-500">
                          {pending.length} pendente{pending.length !== 1 ? 's' : ''}
                          {done.length > 0 && ` · ${done.length} ok`}
                          {failed.length > 0 && ` · ${failed.length} falha`}
                        </p>
                      </div>
                    </div>
                    <Link href={`/logistica/${route.id}`} className="text-[11px] text-indigo-600 hover:underline shrink-0">
                      Detalhes
                    </Link>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto max-h-[500px] divide-y divide-gray-100">
                  {pending.length === 0 ? (
                    <p className="text-xs text-gray-400 px-4 py-6 text-center">Sem paradas pendentes</p>
                  ) : pending.map(stop => (
                    <div key={stop.id} className="px-3 py-2 text-xs hover:bg-gray-50 flex items-start gap-2">
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0',
                        stop.type === 'COLETA' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700')}>
                        {stop.sequence}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 truncate">
                          {stop.os_number ? `#${stop.os_number} ` : ''}{stop.customer_name || 'Cliente'}
                        </p>
                        <p className="text-gray-500 truncate">{stop.address}</p>
                      </div>
                      <button type="button"
                        onClick={() => setMoveModal({ stopId: stop.id, currentRouteId: route.id, customerName: stop.customer_name || 'Cliente' })}
                        disabled={moving === stop.id}
                        className="rounded border border-indigo-200 bg-indigo-50 text-indigo-700 px-2 py-1 text-[10px] font-medium hover:bg-indigo-100 disabled:opacity-50 shrink-0">
                        {moving === stop.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Mover'}
                      </button>
                    </div>
                  ))}
                  {(done.length > 0 || failed.length > 0) && (
                    <div className="px-3 py-2 bg-gray-50">
                      <p className="text-[10px] text-gray-500 font-medium uppercase mb-1">Ja finalizadas</p>
                      {done.map(s => (
                        <div key={s.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          <span className="truncate">{s.os_number ? `#${s.os_number} ` : ''}{s.customer_name}</span>
                        </div>
                      ))}
                      {failed.map(s => (
                        <div key={s.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                          <XCircle className="w-3 h-3 text-red-500" />
                          <span className="truncate">{s.os_number ? `#${s.os_number} ` : ''}{s.customer_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal destino */}
      {moveModal && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/50 p-4" onClick={() => setMoveModal(null)}>
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Mover para</h3>
              <button onClick={() => setMoveModal(null)} className="text-gray-400 hover:text-gray-700">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 px-5 py-2">
              {moveModal.customerName}
            </p>
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
              {targetRoutes.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">Nenhum outro motorista hoje.</p>
              ) : targetRoutes.map(r => (
                <button key={r.id} type="button"
                  onClick={() => moveStop(moveModal.stopId, r.id)}
                  disabled={moving === moveModal.stopId}
                  className="w-full text-left px-5 py-3 hover:bg-indigo-50 flex items-center justify-between gap-3 disabled:opacity-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-gray-900 truncate">
                        {r.driver ? tc(r.driver.name) : 'Sem motorista'}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {r.stops.filter(s => s.status !== 'COMPLETED' && s.status !== 'FAILED').length} pendentes
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
