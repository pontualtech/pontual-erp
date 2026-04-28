'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, Truck, CheckCircle2, AlertTriangle, RefreshCw, User, Route as RouteIcon, X, Play, Pause } from 'lucide-react'

// Leaflet precisa de DOM real — carrega só no client.
const LeafletMap = dynamic(() => import('./leaflet-map'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-100">
      <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  ),
})

type LiveRoute = {
  id: string
  status: string | null
  driver: { id: string; name: string; avatar_url: string | null } | null
  last_location: { lat: number; lng: number; at: string | null } | null
  completed_stops: number | null
  total_stops: number | null
  started_at: string | null
  next_stop_eta: { distance_m: number; duration_s: number; eta_minutes: number; source: string; stop_id: string; customer_name: string | null } | null
  stops: Array<{
    id: string; sequence: number; type: string
    status: string | null; customer_name: string | null; address: string
    lat: number | null; lng: number | null
    completed_at: string | null
    failure_reason: string | null
  }>
}

type FreeDriver = {
  id: string
  name: string
  avatar_url: string | null
  lat: number | null
  lng: number | null
  at: string | null
  accuracy_m: number | null
  has_route_today: boolean
}

type TrailData = {
  driver_id: string
  driver_name: string
  points: Array<{ lat: number; lng: number; at: string; accuracy_m: number | null }>
}

export default function LogisticaLivePage() {
  const [routes, setRoutes] = useState<LiveRoute[]>([])
  const [drivers, setDrivers] = useState<FreeDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  // Trail + replay state
  const [trail, setTrail] = useState<TrailData | null>(null)
  const [playbackIndex, setPlaybackIndex] = useState<number>(-1)  // -1 = live (desliga playback)
  const [playing, setPlaying] = useState(false)

  async function fetchLive() {
    try {
      const res = await fetch('/api/logistica/live', { cache: 'no-store' })
      if (!res.ok) return
      const { data } = await res.json()
      setRoutes(data.routes || [])
      setDrivers(data.drivers || [])
      setLastFetch(new Date())
    } finally { setLoading(false) }
  }

  async function loadTrail(driverId: string, driverName: string) {
    setPlaying(false)
    setPlaybackIndex(-1)
    try {
      const res = await fetch(`/api/logistica/trail/${driverId}`, { cache: 'no-store' })
      if (!res.ok) return
      const { data } = await res.json()
      setTrail({ driver_id: driverId, driver_name: driverName, points: data.points || [] })
    } catch {}
  }

  function clearTrail() {
    setTrail(null)
    setPlaying(false)
    setPlaybackIndex(-1)
  }

  // Auto-playback: avanca 1 frame a cada 300ms
  useEffect(() => {
    if (!playing || !trail) return
    const id = setInterval(() => {
      setPlaybackIndex(prev => {
        if (prev >= trail.points.length - 1) {
          setPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, 300)
    return () => clearInterval(id)
  }, [playing, trail])

  useEffect(() => {
    fetchLive()
    const id = setInterval(fetchLive, 15_000) // 15s polling
    return () => clearInterval(id)
  }, [])

  const activeRoutes = routes.filter(r => r.status === 'IN_PROGRESS')
  const plannedRoutes = routes.filter(r => r.status === 'PLANNED')
  const completedRoutes = routes.filter(r => r.status === 'COMPLETED')
  const freeDrivers = drivers.filter(d => !d.has_route_today)

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/logistica" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-bold text-lg">Rastreamento ao Vivo</h1>
            <p className="text-xs text-gray-500">
              {routes.length} rota(s){freeDrivers.length > 0 && ` · ${freeDrivers.length} livre(s)`}
              {lastFetch && ` · atualizado ${new Date(lastFetch).toLocaleTimeString('pt-BR')}`}
            </p>
          </div>
        </div>
        <button type="button" onClick={fetchLive} disabled={loading}
          aria-label="Atualizar"
          title="Atualizar agora"
          className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Content: map + sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 bg-gray-100 relative">
          {routes.length === 0 && drivers.length === 0 && !loading ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-center">
              <div>
                <Truck className="w-12 h-12 mx-auto mb-2" />
                <p>Nenhum motorista ativo agora</p>
                <p className="text-xs mt-1">Motoristas aparecem aqui assim que abrirem o app</p>
              </div>
            </div>
          ) : (
            <LeafletMap
              routes={routes}
              drivers={drivers}
              trail={trail}
              playbackIndex={playbackIndex}
            />
          )}

          {/* Timeline replay overlay — so aparece quando trail carregado */}
          {trail && trail.points.length > 0 && (
            <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-white rounded-lg shadow-lg p-3 border border-blue-200 z-[1000]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <RouteIcon className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="font-semibold text-sm truncate">
                    Trajeto: {trail.driver_name}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    ({trail.points.length} pts)
                  </span>
                </div>
                <button type="button" onClick={clearTrail}
                  aria-label="Fechar trajeto"
                  className="text-gray-400 hover:text-gray-700">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPlaying(!playing)}
                  aria-label={playing ? 'Pausar' : 'Reproduzir'}
                  className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 shrink-0">
                  {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <input
                  type="range"
                  min={-1}
                  max={trail.points.length - 1}
                  value={playbackIndex}
                  onChange={e => { setPlaybackIndex(Number(e.target.value)); setPlaying(false) }}
                  className="flex-1 accent-blue-600"
                  aria-label="Timeline"
                />
                <span className="text-[10px] text-gray-500 min-w-[55px] text-right font-mono">
                  {playbackIndex < 0
                    ? 'agora'
                    : new Date(trail.points[playbackIndex]?.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar lista de rotas */}
        <aside className="w-80 bg-white border-l overflow-y-auto hidden md:block">
          <section className="p-3 border-b">
            <h2 className="text-xs font-bold uppercase tracking-wider text-blue-700 mb-2">
              Em rota ({activeRoutes.length})
            </h2>
            {activeRoutes.length === 0
              ? <p className="text-xs text-gray-400">Nenhum motorista em rota</p>
              : activeRoutes.map(r => <RouteCard key={r.id} route={r} onViewTrail={loadTrail} />)}
          </section>
          {freeDrivers.length > 0 && (
            <section className="p-3 border-b bg-amber-50/50">
              <h2 className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                Livres ({freeDrivers.length})
              </h2>
              <p className="text-[10px] text-amber-600 mb-2">Motoristas com GPS ativo mas sem rota hoje</p>
              {freeDrivers.map(d => <FreeDriverCard key={d.id} driver={d} onViewTrail={loadTrail} />)}
            </section>
          )}
          {plannedRoutes.length > 0 && (
            <section className="p-3 border-b">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                Planejadas ({plannedRoutes.length})
              </h2>
              {plannedRoutes.map(r => <RouteCard key={r.id} route={r} onViewTrail={loadTrail} />)}
            </section>
          )}
          {completedRoutes.length > 0 && (
            <section className="p-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-green-700 mb-2">
                Finalizadas ({completedRoutes.length})
              </h2>
              {completedRoutes.map(r => <RouteCard key={r.id} route={r} onViewTrail={loadTrail} />)}
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

function FreeDriverCard({ driver, onViewTrail }: { driver: FreeDriver; onViewTrail?: (id: string, name: string) => void }) {
  const agoMin = driver.at
    ? Math.max(0, Math.round((Date.now() - new Date(driver.at).getTime()) / 60000))
    : null
  const hasCoords = driver.lat !== null && driver.lng !== null
  return (
    <div className="bg-white border border-amber-200 rounded-lg p-3 mb-2">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
          {driver.name.charAt(0).toUpperCase()}
        </div>
        <p className="font-medium text-sm truncate flex-1">{driver.name}</p>
      </div>
      <p className="text-[11px] text-amber-700 font-semibold">🚶 Livre — sem rota</p>
      <div className="flex items-center justify-between mt-1">
        {hasCoords ? (
          <p className="text-[10px] text-gray-500">
            GPS: {agoMin === null ? '—' : agoMin < 1 ? 'agora' : `há ${agoMin}min`}
            {driver.accuracy_m ? ` · ±${driver.accuracy_m}m` : ''}
          </p>
        ) : (
          <p className="text-[10px] text-gray-400 italic">Sem localização</p>
        )}
        {onViewTrail && hasCoords && (
          <button type="button"
            onClick={() => onViewTrail(driver.id, driver.name)}
            className="text-[10px] text-blue-600 hover:text-blue-800 font-medium ml-auto flex items-center gap-1">
            <RouteIcon className="w-3 h-3" /> Trajeto
          </button>
        )}
      </div>
    </div>
  )
}

function RouteCard({ route, onViewTrail }: { route: LiveRoute; onViewTrail?: (id: string, name: string) => void }) {
  const pct = route.total_stops
    ? Math.round(((route.completed_stops || 0) / route.total_stops) * 100)
    : 0
  const agoMin = route.last_location?.at
    ? Math.max(0, Math.round((Date.now() - new Date(route.last_location.at).getTime()) / 60000))
    : null

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 mb-2">
      <div className="flex items-center gap-2 mb-2">
        {route.status === 'COMPLETED'
          ? <CheckCircle2 className="w-4 h-4 text-green-600" />
          : route.status === 'IN_PROGRESS'
            ? <Truck className="w-4 h-4 text-blue-600" />
            : <AlertTriangle className="w-4 h-4 text-gray-400" />}
        <p className="font-medium text-sm truncate flex-1">
          {route.driver?.name || 'Sem motorista'}
        </p>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
        <span>{route.completed_stops}/{route.total_stops} paradas</span>
        <span>{pct}%</span>
      </div>
      <div className="bg-gray-200 rounded-full h-1.5 overflow-hidden">
        <div className="bg-blue-600 h-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      {/* ETA pra proxima parada — so aparece em rotas IN_PROGRESS com GPS */}
      {route.next_stop_eta && (
        <div className={`mt-2 px-2 py-1.5 rounded-md border text-[11px] flex items-start gap-1.5 ${route.next_stop_eta.source === 'google' ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
          <span className="font-bold shrink-0">⏱️ ~{route.next_stop_eta.eta_minutes}min</span>
          <span className="truncate">→ {route.next_stop_eta.customer_name || 'proxima'}</span>
          <span className="text-[9px] ml-auto shrink-0">
            {(route.next_stop_eta.distance_m / 1000).toFixed(1)}km
            {route.next_stop_eta.source === 'google' ? ' · trafego real' : ' · estimativa'}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between mt-2">
        {agoMin !== null && (
          <p className="text-[10px] text-gray-400">
            GPS: {agoMin < 1 ? 'agora' : `há ${agoMin}min`}
          </p>
        )}
        {onViewTrail && route.driver && (
          <button type="button"
            onClick={() => onViewTrail(route.driver!.id, route.driver!.name)}
            className="text-[10px] text-blue-600 hover:text-blue-800 font-medium ml-auto flex items-center gap-1">
            <RouteIcon className="w-3 h-3" /> Ver trajeto
          </button>
        )}
      </div>
    </div>
  )
}
