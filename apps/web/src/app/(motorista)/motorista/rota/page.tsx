'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Package, Truck, MapPin, Phone, CheckCircle2, AlertTriangle, RefreshCw, LogOut, MessageCircle } from 'lucide-react'
import SyncBadge from '../../components/sync-badge'
import InstallPrompt from '../../components/install-prompt'

type Stop = {
  id: string
  type: 'COLETA' | 'ENTREGA'
  status: 'PENDING' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' | 'FAILED'
  sequence: number
  customer_name: string
  customer_phone: string
  address: string
  lat: number | null
  lng: number | null
  completed_at: string | null
  failure_reason: string | null
  os: { id: string; number: number; equipment: string; total_cost_cents: number } | null
}

type RouteData = {
  id: string
  status: string
  total_stops: number
  completed_stops: number
}

function fmtBRL(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

// Haversine — distância em km entre (lat1,lng1) e (lat2,lng2)
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export default function RotaHojePage() {
  const router = useRouter()
  const [route, setRoute] = useState<RouteData | null>(null)
  const [stops, setStops] = useState<Stop[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null)

  // Fetch rota
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch('/api/driver/rota/hoje', { cache: 'no-store' })
      if (res.status === 401) { router.replace('/motorista/login'); return }
      if (res.status === 403) { toast.error('Seu perfil nao e de motorista'); return }
      const { data } = await res.json()
      setRoute(data.route)
      setStops(data.stops || [])
    } catch { toast.error('Falha ao carregar rota') }
    finally { setLoading(false); setRefreshing(false) }
  }, [router])

  useEffect(() => { load() }, [load])

  // Live GPS — inicia watchPosition e POSTa a cada posição nova (throttle server)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setMyLocation(loc)
        // Fire-and-forget. Servidor decide se persiste (rate-limited).
        void fetch('/api/driver/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: loc.lat, lng: loc.lng, accuracy_m: pos.coords.accuracy }),
        }).catch(() => {})
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  async function handleLogout() {
    await fetch('/auth/signout', { method: 'POST' }).catch(() => {})
    router.replace('/motorista/login')
  }

  const pendingStops = stops.filter(s => s.status !== 'COMPLETED' && s.status !== 'FAILED')
  const doneStops = stops.filter(s => s.status === 'COMPLETED' || s.status === 'FAILED')

  // Ordena pendentes por proximidade se tivermos localização
  const sortedPending = myLocation
    ? [...pendingStops].sort((a, b) => {
        if (!a.lat || !b.lat) return a.sequence - b.sequence
        const da = distanceKm(myLocation, { lat: a.lat, lng: a.lng! })
        const db = distanceKm(myLocation, { lat: b.lat, lng: b.lng! })
        return da - db
      })
    : pendingStops

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh]">
      <InstallPrompt />
      {/* Header */}
      <header className="sticky top-0 bg-blue-700 text-white px-4 py-3 flex items-center justify-between z-10 shadow">
        <div>
          <h1 className="font-bold text-lg leading-tight">Rota de Hoje</h1>
          <p className="text-xs opacity-80">
            {route ? `${route.completed_stops}/${route.total_stops} finalizadas` : 'Sem rota atribuída'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncBadge />
          <Link href="/motorista/chat" aria-label="Chat com a base"
            className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition">
            <MessageCircle className="w-5 h-5" />
          </Link>
          <button type="button" onClick={() => load(true)} disabled={refreshing} aria-label="Atualizar"
            className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition">
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={handleLogout} aria-label="Sair" className="p-2 rounded-full hover:bg-white/10">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {!route && (
        <div className="p-6 text-center">
          <AlertTriangle className="mx-auto w-12 h-12 text-amber-500 mb-2" />
          <p className="font-medium">Nenhuma rota atribuída para hoje.</p>
          <p className="text-sm text-gray-500 mt-1">
            Fale com o operador do ERP se isso não estiver certo.
          </p>
        </div>
      )}

      {route && (
        <main className="pb-24">
          {/* PENDENTES */}
          <section className="px-4 py-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Pendentes ({sortedPending.length})
            </h2>
            {sortedPending.length === 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <CheckCircle2 className="mx-auto w-12 h-12 text-green-600 mb-2" />
                <p className="font-medium text-green-900">Tudo entregue. Boa rota!</p>
              </div>
            )}
            {sortedPending.map(stop => (
              <StopCard key={stop.id} stop={stop} myLocation={myLocation} />
            ))}
          </section>

          {/* FINALIZADAS */}
          {doneStops.length > 0 && (
            <section className="px-4 pt-2 pb-6 space-y-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Finalizadas ({doneStops.length})
              </h2>
              {doneStops.map(stop => (
                <div key={stop.id}
                  className="bg-white border border-gray-200 rounded-xl p-3 opacity-60 flex items-center gap-3">
                  {stop.status === 'COMPLETED'
                    ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                    : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {stop.type === 'COLETA' ? 'Coleta' : 'Entrega'} — {stop.customer_name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {stop.os ? `OS #${stop.os.number}` : ''} {stop.failure_reason && `— ${stop.failure_reason}`}
                    </p>
                  </div>
                </div>
              ))}
            </section>
          )}
        </main>
      )}
    </div>
  )
}

function StopCard({ stop, myLocation }: { stop: Stop; myLocation: { lat: number; lng: number } | null }) {
  const isColeta = stop.type === 'COLETA'
  const href = isColeta ? `/motorista/coleta/${stop.id}` : `/motorista/entrega/${stop.id}`
  const accent = isColeta ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'
  const Icon = isColeta ? Package : Truck
  const dist = myLocation && stop.lat && stop.lng
    ? distanceKm(myLocation, { lat: stop.lat, lng: stop.lng })
    : null

  return (
    <Link href={href} className="block bg-white border border-gray-200 rounded-xl p-4 active:scale-[0.99] transition shadow-sm hover:shadow">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent} shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
              {isColeta ? 'Coleta' : 'Entrega'}{stop.os ? ` — OS #${stop.os.number}` : ''}
            </span>
            {dist !== null && (
              <span className="text-xs text-gray-400">{dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}</span>
            )}
          </div>
          <h3 className="font-semibold text-gray-900 mt-0.5 truncate">{stop.customer_name || 'Cliente'}</h3>
          <p className="text-sm text-gray-600 mt-1 flex items-start gap-1">
            <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
            <span className="leading-tight">{stop.address}</span>
          </p>
          {stop.os?.equipment && (
            <p className="text-xs text-gray-500 mt-1 truncate">{stop.os.equipment}</p>
          )}
          {!isColeta && stop.os?.total_cost_cents ? (
            <p className="text-sm font-bold text-emerald-700 mt-2">Receber: {fmtBRL(stop.os.total_cost_cents)}</p>
          ) : null}
          {stop.customer_phone && (
            <a href={`tel:${stop.customer_phone}`} onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-blue-600 mt-2">
              <Phone className="w-3 h-3" /> {stop.customer_phone}
            </a>
          )}
        </div>
      </div>
    </Link>
  )
}
