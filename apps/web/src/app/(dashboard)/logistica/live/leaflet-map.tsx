'use client'

import { useEffect, useRef } from 'react'

// Leaflet é carregado via CDN — zero bundle. Ver leaflet-cdn.ts que injeta
// o CSS + JS uma única vez por página.

type LiveRoute = {
  id: string
  status: string | null
  driver: { id: string; name: string; avatar_url: string | null } | null
  last_location: { lat: number; lng: number; at: Date | string | null } | null
  completed_stops: number | null
  total_stops: number | null
  stops: Array<{
    id: string; sequence: number; type: 'COLETA' | 'ENTREGA' | string
    status: string | null; customer_name: string | null; address: string
    lat: number | null; lng: number | null
    completed_at: Date | string | null
    failure_reason: string | null
  }>
}

// Motorista reportando GPS mas que NAO tem rota hoje — entre rotas,
// parado na empresa, tarefa avulsa. Renderizado com cor/icone diferente
// pra diferenciar de quem esta em rota ativa.
type FreeDriver = {
  id: string
  name: string
  avatar_url: string | null
  lat: number | null
  lng: number | null
  at: Date | string | null
  accuracy_m: number | null
  has_route_today: boolean
}

declare global {
  interface Window { L?: any }
}

async function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return null
  if (window.L) return window.L
  // CSS
  if (!document.querySelector('link[data-leaflet]')) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
    link.crossOrigin = ''
    link.setAttribute('data-leaflet', '1')
    document.head.appendChild(link)
  }
  // JS
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-leaflet]')) {
      const check = setInterval(() => { if (window.L) { clearInterval(check); resolve(window.L) } }, 50)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    s.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
    s.crossOrigin = ''
    s.setAttribute('data-leaflet', '1')
    s.onload = () => resolve(window.L)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

// Serie temporal de pontos GPS de um motorista — usado pra desenhar
// o trajeto (polyline) e replay via timeline slider.
type TrailPoint = { lat: number; lng: number; at: string | Date; accuracy_m: number | null }

// Coerce pra number e valida. Prisma devolve lat/lng como Decimal
// (objeto); se passar direto pro Leaflet vira NaN e quebra o mapa.
function toFinite(n: any): number | null {
  if (n == null) return null
  const x = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(x) ? x : null
}

// Haversine — distancia em km entre dois pontos geodesicos.
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lng - a.lng) * Math.PI / 180
  const la1 = a.lat * Math.PI / 180
  const la2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// Decodifica polyline encoded do Google (algoritmo oficial).
// Ref: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
function decodePolyline(str: string): [number, number][] {
  const coords: [number, number][] = []
  let i = 0, lat = 0, lng = 0
  while (i < str.length) {
    let b = 0, shift = 0, result = 0
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)
    shift = 0; result = 0
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)
    coords.push([lat / 1e5, lng / 1e5])
  }
  return coords
}

export type StopRoutePlan = {
  polyline?: string         // compat — primeira polyline
  polylines?: string[]      // todos os segmentos (rotas grandes sao batched)
  total_distance_m: number
  total_duration_s: number
  legs: Array<{ distance_m: number; duration_s: number; from_stop_id: string; to_stop_id: string }>
  source: 'google' | 'haversine'
  hq?: { lat: number; lng: number; formatted?: string } | null
}

export default function LeafletMap({ routes, drivers = [], trail = null, playbackIndex = -1, showStopRoute = false, stopRoutePlan = null }: {
  routes: LiveRoute[]
  drivers?: FreeDriver[]
  trail?: { driver_name: string; points: TrailPoint[] } | null
  playbackIndex?: number  // -1 = desativado (mostra trail completo estatico)
  showStopRoute?: boolean // desenha polyline conectando stops em sequence + distancias
  stopRoutePlan?: StopRoutePlan | null // plano real via Google Routes; se null usa linha reta
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const driverMarkersRef = useRef<Map<string, any>>(new Map())
  const freeDriverMarkersRef = useRef<Map<string, any>>(new Map())
  const stopMarkersRef = useRef<any[]>([])
  const trailLayerRef = useRef<any>(null)
  const playbackMarkerRef = useRef<any>(null)
  const routeLayersRef = useRef<any[]>([]) // polyline + distance labels entre stops
  const hqMarkerRef = useRef<any>(null) // marker da base (sede da empresa)
  // Guarda assinatura pra saber quando "a rota mudou" (novas paradas ou
  // plan atualizado). Usado pra decidir se reajusta o zoom — se o user
  // manualmente fez zoom/pan, nao queremos resetar a cada tick de GPS.
  const fitSignatureRef = useRef<string>('')

  // Init map
  useEffect(() => {
    let cancelled = false
    loadLeaflet().then(L => {
      if (cancelled || !containerRef.current || mapRef.current) return
      // Centro SP por default
      const map = L.map(containerRef.current, { zoomControl: true }).setView([-23.5489, -46.6388], 11)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)
      mapRef.current = map
    })
    return () => { cancelled = true }
  }, [])

  // Sync markers whenever `routes` updates
  useEffect(() => {
    const map = mapRef.current
    if (!map || !window.L) return
    const L = window.L

    // Clear old stop markers
    stopMarkersRef.current.forEach(m => map.removeLayer(m))
    stopMarkersRef.current = []

    // Upsert driver markers
    const seenDrivers = new Set<string>()
    for (const route of routes) {
      if (!route.last_location || !route.driver) continue
      const dLat = toFinite(route.last_location.lat)
      const dLng = toFinite(route.last_location.lng)
      if (dLat == null || dLng == null) continue
      seenDrivers.add(route.driver.id)
      const pos = [dLat, dLng] as [number, number]

      const existing = driverMarkersRef.current.get(route.driver.id)
      if (existing) {
        existing.setLatLng(pos)
      } else {
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:36px;height:36px;background:#2563eb;border:3px solid white;
            border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
            color:white;font-weight:700;font-size:14px;
          ">🚚</div>`,
          iconSize: [36, 36], iconAnchor: [18, 18],
        })
        const marker = L.marker(pos, { icon }).addTo(map)
        marker.bindPopup(buildDriverPopup(route))
        driverMarkersRef.current.set(route.driver.id, marker)
      }
      // Always refresh popup content (completed_stops mudou?)
      driverMarkersRef.current.get(route.driver.id).setPopupContent(buildDriverPopup(route))
    }

    // Remove drivers não mais presentes
    driverMarkersRef.current.forEach((marker, id) => {
      if (!seenDrivers.has(id)) {
        map.removeLayer(marker)
        driverMarkersRef.current.delete(id)
      }
    })

    // Upsert FREE drivers (sem rota hoje) — cor cinza/laranja pra diferenciar
    const seenFree = new Set<string>()
    for (const d of drivers) {
      const fLat = toFinite(d.lat); const fLng = toFinite(d.lng)
      if (fLat == null || fLng == null) continue
      // Pula motoristas que ja estao em rota (ja renderizados acima em azul)
      if (d.has_route_today) continue
      seenFree.add(d.id)
      const pos = [fLat, fLng] as [number, number]
      const existing = freeDriverMarkersRef.current.get(d.id)
      if (existing) {
        existing.setLatLng(pos)
      } else {
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:32px;height:32px;background:#f59e0b;border:3px solid white;
            border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
            color:white;font-weight:700;font-size:14px;
          " title="Livre — sem rota">🚶</div>`,
          iconSize: [32, 32], iconAnchor: [16, 16],
        })
        const marker = L.marker(pos, { icon }).addTo(map)
        freeDriverMarkersRef.current.set(d.id, marker)
      }
      freeDriverMarkersRef.current.get(d.id).setPopupContent(buildFreeDriverPopup(d))
      if (!freeDriverMarkersRef.current.get(d.id).getPopup()) {
        freeDriverMarkersRef.current.get(d.id).bindPopup(buildFreeDriverPopup(d))
      }
    }
    // Remove livres que sumiram
    freeDriverMarkersRef.current.forEach((marker, id) => {
      if (!seenFree.has(id)) {
        map.removeLayer(marker)
        freeDriverMarkersRef.current.delete(id)
      }
    })

    // Adiciona marker pra cada stop. Quando showStopRoute=true, mostra
    // tambem stops COMPLETED/FAILED (em cinza/verde/vermelho) pra dar
    // contexto completo da rota planejada.
    for (const route of routes) {
      for (const stop of route.stops) {
        const sLat = toFinite(stop.lat)
        const sLng = toFinite(stop.lng)
        if (sLat == null || sLng == null) continue
        const isDone = stop.status === 'COMPLETED'
        const isFailed = stop.status === 'FAILED'
        if (!showStopRoute && (isDone || isFailed)) continue

        const baseColor = stop.type === 'COLETA' ? '#9333ea' : stop.type === 'AVULSA' ? '#d97706' : '#059669'
        const color = isFailed ? '#dc2626' : isDone ? '#6b7280' : baseColor
        const label = isDone ? '✓' : isFailed ? '✕' : String(stop.sequence)
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:28px;height:28px;background:${color};border:2px solid white;
            border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
            color:white;font-weight:700;font-size:12px;
            ${isDone ? 'opacity:0.75' : ''}
          ">${label}</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14],
        })
        const marker = L.marker([sLat, sLng], { icon }).addTo(map)
        const statusLabel = isDone ? ' · concluída' : isFailed ? ' · falhou' : ''
        marker.bindPopup(`
          <div style="font-size:12px;max-width:220px">
            <strong>${escapeHtml(stop.customer_name || 'Cliente')}</strong><br/>
            <span style="color:${color};font-weight:600">${stop.type === 'COLETA' ? 'Coleta' : stop.type === 'AVULSA' ? 'Avulsa' : 'Entrega'} #${stop.sequence}${statusLabel}</span><br/>
            <span style="color:#6b7280">${escapeHtml(stop.address)}</span>
          </div>
        `)
        stopMarkersRef.current.push(marker)
      }
    }

    // HQ marker — base da empresa, ponto de partida e retorno da rota
    if (hqMarkerRef.current) {
      map.removeLayer(hqMarkerRef.current)
      hqMarkerRef.current = null
    }
    if (showStopRoute && stopRoutePlan?.hq) {
      const hqLat = toFinite(stopRoutePlan.hq.lat)
      const hqLng = toFinite(stopRoutePlan.hq.lng)
      if (hqLat != null && hqLng != null) {
        const hqIcon = L.divIcon({
          className: '',
          html: `<div style="
            width:34px;height:34px;background:#1e293b;border:3px solid #fbbf24;
            border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.4);
            display:flex;align-items:center;justify-content:center;
            color:white;font-size:18px;
          " title="Base da empresa">🏢</div>`,
          iconSize: [34, 34], iconAnchor: [17, 17],
        })
        hqMarkerRef.current = L.marker([hqLat, hqLng], { icon: hqIcon, zIndexOffset: 1000 }).addTo(map)
        hqMarkerRef.current.bindPopup(`
          <div style="font-size:12px;max-width:240px">
            <strong>🏢 Base</strong><br/>
            <span style="color:#6b7280">${escapeHtml(stopRoutePlan.hq.formatted || 'Ponto de partida e retorno')}</span>
          </div>
        `)
      }
    }

    // ROTA PLANEJADA. Se tem plan do Google (polyline encoded), desenha
    // caminho real pelas ruas + labels com km e min reais. Fallback para
    // linha reta + Haversine quando plan ausente ou polyline vazio.
    routeLayersRef.current.forEach(l => map.removeLayer(l))
    routeLayersRef.current = []
    if (showStopRoute) {
      for (const route of routes) {
        // Normaliza coords: Prisma Decimal -> number validado.
        const ordered = route.stops
          .map(s => ({ ...s, _lat: toFinite(s.lat), _lng: toFinite(s.lng) }))
          .filter(s => s._lat != null && s._lng != null)
          .sort((a, b) => a.sequence - b.sequence)
        if (ordered.length < 2) continue

        // 1) Linha principal — polylines reais do Google (array, pois
        //    rotas grandes sao divididas em batches) ou linha reta.
        const polys = stopRoutePlan?.polylines?.length
          ? stopRoutePlan.polylines
          : (stopRoutePlan?.polyline ? [stopRoutePlan.polyline] : [])
        if (polys.length > 0) {
          for (const p of polys) {
            if (!p) continue
            const coords = decodePolyline(p)
            const line = L.polyline(coords, {
              color: '#4f46e5', weight: 4, opacity: 0.65,
            }).addTo(map)
            routeLayersRef.current.push(line)
          }
        } else {
          const latlngs = ordered.map(s => [s._lat as number, s._lng as number] as [number, number])
          const line = L.polyline(latlngs, {
            color: '#4f46e5', weight: 3, opacity: 0.55, dashArray: '4,6',
          }).addTo(map)
          routeLayersRef.current.push(line)
        }

        // 2) Labels entre paradas. Se tem plan, usa distancia + tempo
        //    reais. Senao, linha reta Haversine.
        const legByStops = new Map<string, { distance_m: number; duration_s: number }>()
        if (stopRoutePlan?.legs) {
          for (const leg of stopRoutePlan.legs) {
            legByStops.set(`${leg.from_stop_id}->${leg.to_stop_id}`, leg)
          }
        }
        for (let i = 0; i < ordered.length - 1; i++) {
          const a = ordered[i]; const b = ordered[i + 1]
          const leg = legByStops.get(`${a.id}->${b.id}`)
          let km: number; let minutes: number | null
          if (leg) {
            km = leg.distance_m / 1000
            minutes = Math.round(leg.duration_s / 60)
          } else {
            km = haversineKm({ lat: a._lat!, lng: a._lng! }, { lat: b._lat!, lng: b._lng! })
            minutes = null
          }
          const midLat = (a._lat! + b._lat!) / 2
          const midLng = (a._lng! + b._lng!) / 2
          if (!Number.isFinite(midLat) || !Number.isFinite(midLng)) continue
          const kmText = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`
          const timeText = minutes != null
            ? (minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}` : `${minutes}min`)
            : ''
          const labelText = timeText ? `${kmText} · ${timeText}` : kmText
          const label = L.marker([midLat, midLng], {
            interactive: false,
            icon: L.divIcon({
              className: '',
              html: `<div style="
                background:white;border:1px solid #4f46e5;color:#4338ca;
                padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;
                white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.15);
                transform:translate(-50%,-50%);display:inline-block;
              ">${labelText}</div>`,
              iconSize: [0, 0], iconAnchor: [0, 0],
            }),
          }).addTo(map)
          routeLayersRef.current.push(label)
        }
      }
    }

    // TRAIL (polyline do trajeto do dia) + PLAYBACK MARKER
    // Se trail tem pontos, desenha uma polyline azul clarinha ligando
    // todos. Se playbackIndex >= 0, mostra um marker "fantasma" na
    // posicao [playbackIndex] — usado pelo slider de replay.
    if (trailLayerRef.current) {
      map.removeLayer(trailLayerRef.current)
      trailLayerRef.current = null
    }
    if (playbackMarkerRef.current) {
      map.removeLayer(playbackMarkerRef.current)
      playbackMarkerRef.current = null
    }
    if (trail && trail.points.length > 1) {
      const latlngs = trail.points.map(p => [p.lat, p.lng] as [number, number])
      trailLayerRef.current = L.polyline(latlngs, {
        color: '#2563eb', weight: 3, opacity: 0.6, dashArray: '6,4',
      }).addTo(map)
      if (playbackIndex >= 0 && playbackIndex < trail.points.length) {
        const pt = trail.points[playbackIndex]
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:34px;height:34px;background:#1e40af;border:3px solid #fef08a;
            border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);
            display:flex;align-items:center;justify-content:center;
            color:white;font-weight:700;font-size:14px;
          ">⏱️</div>`,
          iconSize: [34, 34], iconAnchor: [17, 17],
        })
        playbackMarkerRef.current = L.marker([pt.lat, pt.lng], { icon }).addTo(map)
      }
    }

    // Auto-fit se tiver pontos (inclui motoristas livres + trail no bounds)
    const allLatLngs: [number, number][] = []
    routes.forEach(r => {
      if (r.last_location) {
        const la = toFinite(r.last_location.lat); const ln = toFinite(r.last_location.lng)
        if (la != null && ln != null) allLatLngs.push([la, ln])
      }
      r.stops.forEach(s => {
        const la = toFinite(s.lat); const ln = toFinite(s.lng)
        if (la != null && ln != null && s.status !== 'COMPLETED' && s.status !== 'FAILED') {
          allLatLngs.push([la, ln])
        }
      })
    })
    drivers.forEach(d => {
      const la = toFinite(d.lat); const ln = toFinite(d.lng)
      if (la != null && ln != null && !d.has_route_today) allLatLngs.push([la, ln])
    })
    if (trail && trail.points.length > 0) {
      trail.points.forEach(p => allLatLngs.push([p.lat, p.lng]))
    }
    const boundsPolys = stopRoutePlan?.polylines?.length
      ? stopRoutePlan.polylines
      : (stopRoutePlan?.polyline ? [stopRoutePlan.polyline] : [])
    for (const p of boundsPolys) {
      if (p) decodePolyline(p).forEach(pt => allLatLngs.push(pt))
    }
    if (stopRoutePlan?.hq) {
      const hl = toFinite(stopRoutePlan.hq.lat); const hg = toFinite(stopRoutePlan.hq.lng)
      if (hl != null && hg != null) allLatLngs.push([hl, hg])
    }
    // Assinatura do que pode justificar um re-fit: ids e sequencias das
    // stops + id das rotas + polyline plan (primeiro char e length).
    // Posicao GPS do motorista muda o tempo todo, entao NAO entra na
    // assinatura — evita resetar zoom a cada update de localizacao.
    const sig = [
      routes.map(r => `${r.id}:${r.stops.map(s => `${s.id}/${s.sequence}/${s.status}`).join(',')}`).join('|'),
      stopRoutePlan?.polylines?.join('')?.length || 0,
      stopRoutePlan?.polyline?.length || 0,
    ].join('#')
    if (allLatLngs.length > 1 && fitSignatureRef.current !== sig) {
      const bounds = L.latLngBounds(allLatLngs)
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
      fitSignatureRef.current = sig
    }
  }, [routes, drivers, trail, playbackIndex, showStopRoute, stopRoutePlan])

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
}

function buildDriverPopup(route: LiveRoute): string {
  const at = route.last_location?.at ? new Date(route.last_location.at) : null
  const agoMin = at ? Math.round((Date.now() - at.getTime()) / 60000) : null
  const agoText = agoMin === null ? '' : agoMin < 1 ? 'agora' : `há ${agoMin}min`
  return `
    <div style="font-size:13px;min-width:200px">
      <strong>${escapeHtml(route.driver?.name || 'Motorista')}</strong><br/>
      <span style="color:#6b7280">${route.completed_stops}/${route.total_stops} paradas</span><br/>
      <span style="color:#9ca3af;font-size:11px">Última atualização: ${agoText}</span>
    </div>
  `
}

function buildFreeDriverPopup(d: FreeDriver): string {
  const at = d.at ? new Date(d.at) : null
  const agoMin = at ? Math.round((Date.now() - at.getTime()) / 60000) : null
  const agoText = agoMin === null ? '' : agoMin < 1 ? 'agora' : `há ${agoMin}min`
  const acc = d.accuracy_m ? ` · ±${d.accuracy_m}m` : ''
  return `
    <div style="font-size:13px;min-width:200px">
      <strong>${escapeHtml(d.name)}</strong><br/>
      <span style="color:#f59e0b;font-weight:600">Livre · sem rota hoje</span><br/>
      <span style="color:#9ca3af;font-size:11px">Última atualização: ${agoText}${acc}</span>
    </div>
  `
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as string] || c
  ))
}
