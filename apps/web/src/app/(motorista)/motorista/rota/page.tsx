'use client'

import { useEffect, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Package, Truck, MapPin, Phone, CheckCircle2, AlertTriangle, RefreshCw, LogOut, MessageCircle, ArrowUp, ArrowDown, CalendarClock, Printer, X, Navigation, Plus, ClipboardList, Check } from 'lucide-react'
import SyncBadge from '../../components/sync-badge'
import InstallPrompt from '../../components/install-prompt'
import PushPermission from '../../components/push-permission'
import StopChat from '../_components/StopChat'
import { getCompanyTheme, type CompanyTheme } from '../_components/company-theme'

// Leaflet precisa de DOM — dynamic client-side only.
const LeafletMap = dynamic(() => import('../../../(dashboard)/logistica/live/leaflet-map'), {
  ssr: false,
  loading: () => <div className="h-[280px] bg-gray-100 animate-pulse" />,
})

type Stop = {
  id: string
  type: 'COLETA' | 'ENTREGA' | 'AVULSA'
  status: 'PENDING' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' | 'FAILED'
  sequence: number
  customer_name: string
  customer_phone: string
  address: string
  lat: number | null
  lng: number | null
  notes?: string | null
  completed_at: string | null
  failure_reason: string | null
  os: { id: string; number: number; equipment: string; total_cost_cents: number } | null
  // Visit notification (optional — endpoint /api/driver/rota/hoje passa os campos se existirem)
  visit_notified_at?: string | null
  visit_confirmed_at?: string | null
  visit_reschedule_at?: string | null
  visit_reschedule_note?: string | null
  visit_eta_minutes?: number | null
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
  const [postponeModal, setPostponeModal] = useState<{ stopId: string; customerName: string } | null>(null)
  const [postponeReason, setPostponeReason] = useState('')
  const [postponing, setPostponing] = useState(false)
  const [routeTotals, setRouteTotals] = useState<{ distance_m: number; duration_s: number; source: 'google' | 'haversine' } | null>(null)
  const [routePlanFull, setRoutePlanFull] = useState<any>(null) // passado pro LeafletMap pra desenhar polyline real
  const [company, setCompany] = useState<{ slug: string; name: string; logo: string | null } | null>(null)
  const theme: CompanyTheme = getCompanyTheme(company?.slug)

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
      if (data.company) setCompany(data.company)
    } catch { toast.error('Falha ao carregar rota') }
    finally { setLoading(false); setRefreshing(false) }
  }, [router])

  useEffect(() => { load() }, [load])

  // Busca totais reais da rota (Google Routes) — mesma API que a tela
  // do atendente. Motorista ve "52 km - 1h 40min" no topo da rota.
  useEffect(() => {
    if (!route?.id) return
    let cancelled = false
    fetch(`/api/logistics/routes/${route.id}/plan`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (cancelled || !j?.data) return
        setRoutePlanFull(j.data)
        setRouteTotals({
          distance_m: Number(j.data.total_distance_m) || 0,
          duration_s: Number(j.data.total_duration_s) || 0,
          source: j.data.source || 'haversine',
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [route?.id])

  // Wake Lock: mantem tela acesa enquanto motorista esta na pagina da rota.
  // Sem isso, celular entra em lock screen e GPS deixa de atualizar — gestor
  // perde o rastreamento. A lock e re-adquirida em 3 cenarios (UX-1 #7):
  // 1. Mount inicial
  // 2. visibilitychange (volta de background)
  // 3. release event (Android revoga em modo economia / bateria baixa)
  useEffect(() => {
    let lock: any = null
    let cancelled = false

    async function acquire() {
      if (cancelled) return
      try {
        // @ts-ignore — wakeLock nao esta nos typings DOM por default
        if ('wakeLock' in navigator) {
          // @ts-ignore
          lock = await navigator.wakeLock.request('screen')
          // Re-aquire automaticamente quando o sistema revoga
          lock?.addEventListener?.('release', () => {
            if (!cancelled && !document.hidden) {
              // backoff curto: tenta de novo em 2s pra evitar tight loop
              setTimeout(() => { void acquire() }, 2000)
            }
          })
        }
      } catch { /* ignora; alguns iOS antigos nao suportam */ }
    }
    const onVisibility = () => { if (!document.hidden) void acquire() }
    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      try { lock?.release?.() } catch {}
    }
  }, [])

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

  async function handleMove(stopId: string, direction: 'up' | 'down' | 'bottom') {
    try {
      const res = await fetch(`/api/driver/stop/${stopId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Erro' }))
        toast.error(error || 'Nao foi possivel mover')
        return
      }
      await load(true)
    } catch { toast.error('Erro de conexao') }
  }

  async function handlePostpone() {
    if (!postponeModal || !postponeReason.trim()) return
    setPostponing(true)
    try {
      const res = await fetch(`/api/driver/stop/${postponeModal.stopId}/adiar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: postponeReason.trim() }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Erro' }))
        toast.error(error || 'Erro ao adiar')
        return
      }
      toast.success('Parada adiada pro fim da rota')
      setPostponeModal(null)
      setPostponeReason('')
      await load(true)
    } catch { toast.error('Erro de conexao') }
    finally { setPostponing(false) }
  }

  // AVULSA: motorista toca "Cheguei" ou "Concluido" inline, sem sair da rota.
  async function avulsaAction(stopId: string, action: 'arrive' | 'complete') {
    try {
      const res = await fetch(`/api/driver/stop/${stopId}/avulsa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(j?.error || 'Falha'); return }
      toast.success(action === 'arrive' ? 'Chegada registrada' : 'Parada concluida')
      await load(true)
    } catch { toast.error('Erro de conexao') }
  }

  // Handler invocado pelo StopCard ao tocar "Avisar cliente que estou a caminho".
  // Calcula ETA aproximado via distância / 20km/h (SP urbano médio).
  async function notifyCustomer(stopId: string, distKm: number | null) {
    const etaMinutes = distKm !== null ? Math.max(5, Math.round((distKm / 20) * 60)) : null
    try {
      const res = await fetch(`/api/driver/stop/${stopId}/a-caminho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eta_minutes: etaMinutes }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Falha ao notificar cliente'); return }
      if (data.data?.whatsapp === 'sent') toast.success('Cliente notificado via WhatsApp')
      else if (data.data?.whatsapp === 'skipped_no_phone') toast.warning('Cliente sem telefone cadastrado')
      else if (data.data?.whatsapp === 'failed') toast.error('WhatsApp falhou — copie o link do retorno')
      await load(true)  // refresh a lista pra mostrar "Aguardando cliente"
    } catch { toast.error('Erro de conexão') }
  }

  // Estatísticas do dia
  const pendingStops = stops.filter(s => s.status !== 'COMPLETED' && s.status !== 'FAILED')
  const confirmedCount = pendingStops.filter(s => s.visit_confirmed_at).length
  const toCollectCents = stops
    .filter(s => s.type === 'ENTREGA' && s.status !== 'FAILED' && s.os?.total_cost_cents)
    .reduce((sum, s) => sum + (s.os?.total_cost_cents || 0), 0)
  const doneStops = stops.filter(s => s.status === 'COMPLETED' || s.status === 'FAILED')

  // Ordem planejada pelo admin (sequence asc) — NAO reordenar por GPS.
  // Admin define a sequencia em /logistica/nova ou /logistica/[id]; o
  // motorista deve seguir essa ordem, nao pular baseado em proximidade.
  const sortedPending = [...pendingStops].sort((a, b) => a.sequence - b.sequence)

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
      <PushPermission />
      {/* Header — tema por empresa (cor da brand) */}
      <header className={`sticky top-0 px-4 py-3 flex items-center justify-between z-10 shadow ${theme.headerBg}`}>
        <div>
          <h1 className="font-bold text-lg leading-tight flex items-center gap-2">
            {theme.brandName}
            <span className="opacity-70 font-normal text-sm">· Rota</span>
          </h1>
          <p className={`text-xs ${theme.headerAccent}`}>
            {route ? `${route.completed_stops}/${route.total_stops} finalizadas` : 'Sem rota atribuída'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncBadge />
          <Link href="/motorista/avulso" aria-label="Nova parada avulsa"
            className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition"
            title="Lancar coleta/entrega fora de rota">
            <Plus className="w-5 h-5" />
          </Link>
          <Link href="/motorista/chat" aria-label="Chat com a base"
            className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition">
            <MessageCircle className="w-5 h-5" />
          </Link>
          {route && (
            <Link href={`/logistica/${route.id}/imprimir`} target="_blank" rel="noopener"
              aria-label="Imprimir rota"
              className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition">
              <Printer className="w-5 h-5" />
            </Link>
          )}
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
          {/* Stats bar do dia — 3 metricas visiveis logo no topo */}
          <section className="px-4 py-3 bg-white border-b border-gray-200">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-2xl font-bold text-blue-700">{sortedPending.length}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Pendentes</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-700">{confirmedCount}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Confirmadas</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-700">{toCollectCents > 0 ? fmtBRL(toCollectCents) : '—'}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">A receber</div>
              </div>
            </div>
            {/* Totais da rota (Google Routes) — aparece so se conseguiu calcular */}
            {routeTotals && (routeTotals.distance_m > 0 || routeTotals.duration_s > 0) && (
              <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-indigo-800 bg-indigo-50 rounded-lg py-1.5 px-3">
                <span>📍 <strong>{(routeTotals.distance_m / 1000).toFixed(1)} km</strong> totais</span>
                <span className="text-indigo-300">·</span>
                <span>⏱️ <strong>
                  {routeTotals.duration_s >= 3600
                    ? `${Math.floor(routeTotals.duration_s / 3600)}h${String(Math.round((routeTotals.duration_s % 3600) / 60)).padStart(2, '0')}`
                    : `${Math.round(routeTotals.duration_s / 60)} min`}
                </strong></span>
                {routeTotals.source === 'google' && <span className="text-indigo-400">· trafego real</span>}
              </div>
            )}
          </section>

          {/* Mapa da rota — mesma polyline real da tela do atendente.
              Motorista ve visao geral e decide se quer 'seguir' via
              navegador do celular (Google Maps / Waze). */}
          {route && stops.some(s => s.lat != null && s.lng != null) && (
            <section className="px-4 pt-3">
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white">
                <div className="h-[260px] relative">
                  <LeafletMap
                    routes={[{
                      id: route.id,
                      status: route.status,
                      driver: null,
                      last_location: myLocation ? { lat: myLocation.lat, lng: myLocation.lng, at: new Date() } : null,
                      completed_stops: stops.filter(s => s.status === 'COMPLETED').length,
                      total_stops: stops.length,
                      stops: stops.map(s => ({
                        id: s.id, sequence: s.sequence, type: s.type, status: s.status,
                        customer_name: s.customer_name, address: s.address,
                        lat: s.lat, lng: s.lng,
                        completed_at: null, failure_reason: null,
                      })),
                    }]}
                    showStopRoute
                    stopRoutePlan={routePlanFull}
                  />
                </div>
              </div>
            </section>
          )}

          {/* PRÓXIMA PARADA — hero card gigante */}
          {sortedPending.length > 0 && (
            <section className="px-4 pt-4 pb-2">
              <p className={`text-[10px] font-bold uppercase tracking-[0.15em] mb-2 ${theme.nextLabel}`}>
                👉 Próxima parada
              </p>
              <StopCard stop={sortedPending[0]} myLocation={myLocation} theme={theme}
                onNotifyCustomer={notifyCustomer}
                onMove={handleMove}
                onAskPostpone={s => { setPostponeModal({ stopId: s.id, customerName: s.customer_name }); setPostponeReason('') }}
                onAvulsaAction={avulsaAction}
                featured />
            </section>
          )}

          {/* DEMAIS PENDENTES — cards compactos */}
          {sortedPending.length > 1 && (
            <section className="px-4 pt-4 pb-2 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Depois ({sortedPending.length - 1})
              </p>
              {sortedPending.slice(1).map(stop => (
                <StopCard key={stop.id} stop={stop} myLocation={myLocation} theme={theme}
                  onNotifyCustomer={notifyCustomer}
                  onMove={handleMove}
                  onAskPostpone={s => { setPostponeModal({ stopId: s.id, customerName: s.customer_name }); setPostponeReason('') }}
                  onAvulsaAction={avulsaAction} />
              ))}
            </section>
          )}

          {sortedPending.length === 0 && (
            <section className="px-4 py-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                <CheckCircle2 className="mx-auto w-16 h-16 text-green-600 mb-3" />
                <p className="font-bold text-green-900 text-lg">Tudo entregue!</p>
                <p className="text-sm text-green-700 mt-1">Boa rota, motorista 🏁</p>
              </div>
            </section>
          )}

          {/* FINALIZADAS */}
          {doneStops.length > 0 && (
            <section className="px-4 pt-2 pb-6 space-y-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Finalizadas ({doneStops.length})
              </h2>
              {doneStops.map(stop => {
                const isAvulsa = stop.type === 'AVULSA'
                // AVULSA nao tem form de edicao — so leitura
                const editable = stop.status === 'COMPLETED' && !isAvulsa
                const editHref = editable
                  ? (stop.type === 'COLETA' ? `/motorista/coleta/${stop.id}` : `/motorista/entrega/${stop.id}`)
                  : null
                const typeLabel = isAvulsa ? 'Parada avulsa' : (stop.type === 'COLETA' ? 'Coleta' : 'Entrega')
                const content = (
                  <div className="flex items-center gap-3 w-full">
                    {stop.status === 'COMPLETED'
                      ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                      : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {typeLabel} — {stop.customer_name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {stop.os ? `OS #${stop.os.number}` : ''} {stop.failure_reason && `— ${stop.failure_reason}`}
                      </p>
                    </div>
                    {editable && (
                      <span className="text-[10px] text-amber-600 font-semibold shrink-0">✏️ Editar</span>
                    )}
                  </div>
                )
                return editable && editHref ? (
                  <Link key={stop.id} href={editHref}
                    className="block bg-white border border-gray-200 rounded-xl p-3 opacity-75 active:scale-[0.99] hover:opacity-100 transition">
                    {content}
                  </Link>
                ) : (
                  <div key={stop.id} className="bg-white border border-gray-200 rounded-xl p-3 opacity-60">
                    {content}
                  </div>
                )
              })}
            </section>
          )}
        </main>
      )}

      {/* Modal de adiar parada */}
      {postponeModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={() => !postponing && setPostponeModal(null)}>
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg flex items-center gap-2 text-amber-700">
                <CalendarClock className="w-5 h-5" />
                Adiar parada
              </h3>
              <button type="button" onClick={() => setPostponeModal(null)} disabled={postponing}
                className="text-gray-400 hover:text-gray-600 p-1" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              <strong>{postponeModal.customerName}</strong> vai pro fim da rota. Volta a ficar pendente — voce pode tentar novamente depois.
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Motivo
              </label>
              <div className="flex flex-wrap gap-1.5">
                {['Cliente ausente', 'Portao fechado', 'Pediu voltar depois', 'Horario combinado'].map(preset => (
                  <button key={preset} type="button"
                    onClick={() => setPostponeReason(preset)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${postponeReason === preset ? 'bg-amber-100 border-amber-300 text-amber-800' : 'border-gray-200 text-gray-600'} active:scale-95`}>
                    {preset}
                  </button>
                ))}
              </div>
              <textarea
                value={postponeReason}
                onChange={e => setPostponeReason(e.target.value)}
                placeholder="Ou descreva: ex. cliente pediu pra voltar apos 15h"
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:border-amber-500 focus:outline-none resize-none"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setPostponeModal(null)} disabled={postponing}
                className="flex-1 rounded-lg border px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-[0.99]">
                Cancelar
              </button>
              <button type="button" onClick={handlePostpone}
                disabled={!postponeReason.trim() || postponing}
                className="flex-[2] rounded-lg bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50 active:scale-[0.99] flex items-center justify-center gap-2">
                {postponing && <RefreshCw className="w-4 h-4 animate-spin" />}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StopCard({ stop, myLocation, onNotifyCustomer, onMove, onAskPostpone, onAvulsaAction, featured = false, theme }: {
  stop: Stop
  myLocation: { lat: number; lng: number } | null
  onNotifyCustomer: (stopId: string, distKm: number | null) => Promise<void>
  onMove: (stopId: string, direction: 'up' | 'down' | 'bottom') => Promise<void>
  onAskPostpone: (stop: Stop) => void
  onAvulsaAction: (stopId: string, action: 'arrive' | 'complete') => Promise<void>
  featured?: boolean
  theme: CompanyTheme
}) {
  if (stop.type === 'AVULSA') {
    return <AvulsaCard stop={stop} myLocation={myLocation} onAvulsaAction={onAvulsaAction} featured={featured} />
  }
  const isColeta = stop.type === 'COLETA'
  const href = isColeta ? `/motorista/coleta/${stop.id}` : `/motorista/entrega/${stop.id}`
  // Hero (featured) usa a cor FORTE da brand; compact usa tom clarinho
  const accent = featured
    ? (isColeta ? theme.coletaBgHero : theme.entregaBgHero)
    : (isColeta ? theme.coletaBg : theme.entregaBg)
  const heroBorder = featured
    ? theme.nextRing + ' shadow-lg'
    : 'border-gray-200'
  const Icon = isColeta ? Package : Truck
  const dist = myLocation && stop.lat && stop.lng
    ? distanceKm(myLocation, { lat: stop.lat, lng: stop.lng })
    : null

  const [notifying, setNotifying] = useState(false)
  const [eta, setEta] = useState<{ minutes: number; distance_m: number; source: string } | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Busca ETA real (Distance Matrix Google com trafego) SO pra hero card,
  // porque e o unico visivel em destaque. Cache 5min do lado server, entao
  // polling a cada 60s aqui e seguro.
  useEffect(() => {
    if (!featured || !stop.lat || !stop.lng) return
    let cancelled = false
    async function fetchEta() {
      try {
        const res = await fetch(`/api/driver/eta?stopId=${stop.id}`, { cache: 'no-store' })
        if (!res.ok) return
        const { data } = await res.json()
        if (!cancelled) setEta({ minutes: data.eta_minutes, distance_m: data.distance_m, source: data.source })
      } catch {}
    }
    fetchEta()
    const id = setInterval(fetchEta, 60_000) // 1min
    return () => { cancelled = true; clearInterval(id) }
  }, [featured, stop.id, stop.lat, stop.lng])

  // Polling leve do unread_count quando stop ja foi notificado e o chat
  // esta fechado. Se aberto, o proprio drawer cuida do incremental.
  // 30s pra nao sobrecarregar — notificacao push cuidaria disso melhor
  // mas no MVP isso basta.
  useEffect(() => {
    if (!featured) return
    const shouldPoll = (stop.visit_notified_at || stop.status === 'EN_ROUTE' || stop.status === 'ARRIVED') && !chatOpen
    if (!shouldPoll) return
    let cancelled = false
    async function check() {
      try {
        const res = await fetch(`/api/driver/stop/${stop.id}/messages`, { cache: 'no-store' })
        if (!res.ok) return
        const { data } = await res.json()
        if (!cancelled) setUnreadCount(Number(data.unread_count || 0))
      } catch {}
    }
    check()
    const id = setInterval(check, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [featured, stop.id, stop.status, stop.visit_notified_at, chatOpen])

  // Quando motorista abrir o chat, zera o badge local imediatamente
  // (o fetch do drawer vai reagir mas visualmente some na hora).
  useEffect(() => { if (chatOpen) setUnreadCount(0) }, [chatOpen])

  // Estado da notificação ao cliente
  const confirmed = !!stop.visit_confirmed_at
  const rescheduled = !!stop.visit_reschedule_at
  const notified = !!stop.visit_notified_at
  const statusBadge = confirmed
    ? { bg: 'bg-green-100', fg: 'text-green-700', label: '✓ Cliente confirmou' }
    : rescheduled
      ? { bg: 'bg-amber-100', fg: 'text-amber-700', label: '⚠ Pediu remarcar' }
      : notified
        ? { bg: 'bg-blue-100', fg: 'text-blue-700', label: '⏳ Aguardando cliente' }
        : null

  async function handleNotify(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setNotifying(true)
    try { await onNotifyCustomer(stop.id, dist) }
    finally { setNotifying(false) }
  }

  // Diferença visual entre hero (featured) e compact
  if (featured) {
    return (
      <>
      <div className={`bg-white border-2 ${heroBorder} rounded-2xl overflow-hidden shadow-lg`}>
        <Link href={href} className="block p-5 active:scale-[0.99] transition">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${accent} shrink-0 shadow`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {isColeta ? 'Coleta' : 'Entrega'}{stop.os ? ` · OS #${stop.os.number}` : ''}
              </p>
              <h3 className="text-lg font-bold text-gray-900 truncate leading-tight">
                {stop.customer_name || 'Cliente'}
              </h3>
            </div>
            {dist !== null && (
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${isColeta ? 'bg-purple-50 text-purple-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}
                </span>
                {eta && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${eta.source === 'google' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
                    title={eta.source === 'google' ? 'ETA com trafego real' : 'ETA estimado'}>
                    ⏱️ ~{eta.minutes}min
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 text-sm text-gray-700 mb-2">
            <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
            <span className="leading-snug">{stop.address}</span>
          </div>

          {stop.os?.equipment && (
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <Package className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{stop.os.equipment}</span>
            </div>
          )}

          {!isColeta && stop.os?.total_cost_cents ? (
            <div className="mt-3 flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">A receber</span>
              <span className="text-lg font-bold text-emerald-700">{fmtBRL(stop.os.total_cost_cents)}</span>
            </div>
          ) : null}

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {stop.customer_phone && (
              <a href={`tel:${stop.customer_phone}`} onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 text-sm bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-medium">
                <Phone className="w-3.5 h-3.5" /> Ligar
              </a>
            )}
            {/* Navegar: abre Google Maps (universal — mobile escolhe app). */}
            {stop.lat != null && stop.lng != null && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`}
                target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 text-sm bg-green-50 text-green-700 px-3 py-1.5 rounded-full font-medium active:scale-95">
                <Navigation className="w-3.5 h-3.5" /> Navegar
              </a>
            )}
            {/* Chat disponivel apos motorista avisar que esta a caminho (notified)
                ou quando stop ja esta ativo (EN_ROUTE/ARRIVED). Evita botao
                'morto' antes de iniciar a ida. */}
            {(notified || stop.status === 'EN_ROUTE' || stop.status === 'ARRIVED') && (
              <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); setChatOpen(true) }}
                className={`relative inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full font-medium transition ${
                  unreadCount > 0
                    ? 'bg-red-500 text-white hover:bg-red-600 shadow-md animate-pulse'
                    : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                }`}>
                <MessageCircle className="w-3.5 h-3.5" />
                {unreadCount > 0 ? `${unreadCount} nova${unreadCount > 1 ? 's' : ''}` : 'Conversar'}
              </button>
            )}
            {statusBadge && (
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${statusBadge.bg} ${statusBadge.fg}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
          {rescheduled && stop.visit_reschedule_note && (
            <p className="text-xs text-amber-700 italic mt-2 bg-amber-50 p-2 rounded">&quot;{stop.visit_reschedule_note}&quot;</p>
          )}
        </Link>

        {!notified && !confirmed && stop.status !== 'COMPLETED' && stop.status !== 'FAILED' && (
          <button type="button" onClick={handleNotify} disabled={notifying}
            className="w-full py-3 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2 transition bg-amber-500 hover:bg-amber-600 border-b-4 border-amber-700">
            {notifying ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Enviando…</>
            ) : (
              <>📢 Avisar cliente que estou a caminho</>
            )}
          </button>
        )}

        <Link href={href} className={`block w-full py-4 text-base font-extrabold text-center text-white active:scale-[0.99] transition ${theme.primaryBg} ${theme.primaryHover}`}>
          {isColeta ? '🚀 Iniciar Coleta →' : '🚀 Iniciar Entrega →'}
        </Link>

        {/* Controles de reordenar/adiar — sempre visiveis na hero card */}
        <div className="flex items-center border-t border-gray-200 bg-gray-50">
          <button type="button" onClick={() => onMove(stop.id, 'up')}
            className="flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-100 active:scale-[0.99]">
            <ArrowUp className="w-3.5 h-3.5" /> Subir
          </button>
          <div className="w-px bg-gray-200 h-5" />
          <button type="button" onClick={() => onMove(stop.id, 'down')}
            className="flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-100 active:scale-[0.99]">
            <ArrowDown className="w-3.5 h-3.5" /> Descer
          </button>
          <div className="w-px bg-gray-200 h-5" />
          <button type="button" onClick={() => onAskPostpone(stop)}
            className="flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 active:scale-[0.99]">
            <CalendarClock className="w-3.5 h-3.5" /> Adiar
          </button>
        </div>
      </div>
      <StopChat stopId={stop.id} customerName={stop.customer_name || 'Cliente'}
        open={chatOpen} onClose={() => setChatOpen(false)} />
      </>
    )
  }

  // COMPACT CARD
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <Link href={href} className="block p-3 active:scale-[0.99] transition">
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent} shrink-0`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {isColeta ? 'Coleta' : 'Entrega'}{stop.os ? ` · #${stop.os.number}` : ''}
              </span>
              {dist !== null && (
                <span className="text-[10px] text-gray-400">{dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}</span>
              )}
            </div>
            <h3 className="font-semibold text-gray-900 text-sm truncate leading-tight">{stop.customer_name || 'Cliente'}</h3>
            <p className="text-xs text-gray-500 truncate mt-0.5">{stop.address}</p>
            {statusBadge && (
              <span className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadge.bg} ${statusBadge.fg}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Controles inline — nao passam pelo Link pra evitar navegacao */}
      <div className="flex items-center border-t border-gray-100 bg-gray-50">
        <button type="button" onClick={() => onMove(stop.id, 'up')}
          className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] text-gray-600 hover:bg-gray-100 active:scale-95"
          aria-label="Subir">
          <ArrowUp className="w-3 h-3" /> Subir
        </button>
        <div className="w-px bg-gray-200 h-4" />
        <button type="button" onClick={() => onMove(stop.id, 'down')}
          className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] text-gray-600 hover:bg-gray-100 active:scale-95"
          aria-label="Descer">
          <ArrowDown className="w-3 h-3" /> Descer
        </button>
        <div className="w-px bg-gray-200 h-4" />
        <button type="button" onClick={() => onAskPostpone(stop)}
          className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 active:scale-95"
          aria-label="Adiar">
          <CalendarClock className="w-3 h-3" /> Adiar
        </button>
      </div>
    </div>
  )
}

/**
 * AvulsaCard — parada sem OS (fornecedor, mecanico, banco).
 * UI minima: titulo, endereco, notas; acoes inline "Cheguei" e "Concluido".
 * Nao tem: telefone, OS, chat, notificacao ao cliente, pagamento, assinatura.
 */
function AvulsaCard({ stop, myLocation, onAvulsaAction, featured }: {
  stop: Stop
  myLocation: { lat: number; lng: number } | null
  onAvulsaAction: (stopId: string, action: 'arrive' | 'complete') => Promise<void>
  featured?: boolean
}) {
  const [busy, setBusy] = useState<'arrive' | 'complete' | null>(null)
  const dist = myLocation && stop.lat && stop.lng
    ? distanceKm(myLocation, { lat: stop.lat, lng: stop.lng })
    : null
  const arrived = stop.status === 'ARRIVED'

  async function click(action: 'arrive' | 'complete') {
    setBusy(action)
    try { await onAvulsaAction(stop.id, action) }
    finally { setBusy(null) }
  }

  const headerTone = featured ? 'border-2 border-amber-400 shadow-lg' : 'border border-amber-200'

  return (
    <div className={`bg-white ${headerTone} rounded-2xl overflow-hidden`}>
      <div className={`${featured ? 'p-5' : 'p-3'}`}>
        <div className="flex items-center gap-3 mb-2">
          <div className={`${featured ? 'w-12 h-12' : 'w-8 h-8'} rounded-xl flex items-center justify-center bg-amber-100 text-amber-700 shrink-0`}>
            <ClipboardList className={featured ? 'w-6 h-6' : 'w-4 h-4'} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
              Parada avulsa (sem OS)
            </p>
            <h3 className={`${featured ? 'text-lg' : 'text-sm'} font-bold text-gray-900 truncate leading-tight`}>
              {stop.customer_name || 'Parada'}
            </h3>
          </div>
          {dist !== null && (
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-800 shrink-0">
              {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}
            </span>
          )}
        </div>
        <div className="flex items-start gap-2 text-sm text-gray-700 mb-1">
          <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
          <span className="leading-snug">{stop.address}</span>
        </div>
        {stop.notes ? (
          <p className="text-xs text-gray-500 italic mt-1">&quot;{stop.notes}&quot;</p>
        ) : null}
        {stop.lat != null && stop.lng != null && (
          <div className="mt-3">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm bg-green-50 text-green-700 px-3 py-1.5 rounded-full font-medium active:scale-95">
              <Navigation className="w-3.5 h-3.5" /> Navegar
            </a>
          </div>
        )}
      </div>
      <div className="flex items-center border-t border-amber-200">
        {!arrived && (
          <button type="button" onClick={() => click('arrive')} disabled={busy !== null}
            className="flex-1 py-3 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 active:scale-[0.99] flex items-center justify-center gap-2">
            {busy === 'arrive' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            Cheguei
          </button>
        )}
        <button type="button" onClick={() => click('complete')} disabled={busy !== null}
          className="flex-1 py-3 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 active:scale-[0.99] flex items-center justify-center gap-2">
          {busy === 'complete' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Concluir
        </button>
      </div>
    </div>
  )
}
