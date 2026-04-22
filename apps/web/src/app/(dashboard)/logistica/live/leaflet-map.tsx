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

export default function LeafletMap({ routes, drivers = [] }: { routes: LiveRoute[]; drivers?: FreeDriver[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const driverMarkersRef = useRef<Map<string, any>>(new Map())
  const freeDriverMarkersRef = useRef<Map<string, any>>(new Map())
  const stopMarkersRef = useRef<any[]>([])

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
      seenDrivers.add(route.driver.id)
      const pos = [route.last_location.lat, route.last_location.lng] as [number, number]

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
      if (!d.lat || !d.lng) continue
      // Pula motoristas que ja estao em rota (ja renderizados acima em azul)
      if (d.has_route_today) continue
      seenFree.add(d.id)
      const pos = [d.lat, d.lng] as [number, number]
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

    // Adiciona marker pra cada stop pendente
    for (const route of routes) {
      for (const stop of route.stops) {
        if (!stop.lat || !stop.lng) continue
        if (stop.status === 'COMPLETED' || stop.status === 'FAILED') continue
        const color = stop.type === 'COLETA' ? '#9333ea' : '#059669'
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:28px;height:28px;background:${color};border:2px solid white;
            border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
            color:white;font-weight:700;font-size:12px;
          ">${stop.sequence}</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14],
        })
        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map)
        marker.bindPopup(`
          <div style="font-size:12px;max-width:220px">
            <strong>${escapeHtml(stop.customer_name || 'Cliente')}</strong><br/>
            <span style="color:${color};font-weight:600">${stop.type === 'COLETA' ? 'Coleta' : 'Entrega'} #${stop.sequence}</span><br/>
            <span style="color:#6b7280">${escapeHtml(stop.address)}</span>
          </div>
        `)
        stopMarkersRef.current.push(marker)
      }
    }

    // Auto-fit se tiver pontos (inclui motoristas livres no bounds)
    const allLatLngs: [number, number][] = []
    routes.forEach(r => {
      if (r.last_location) allLatLngs.push([r.last_location.lat, r.last_location.lng])
      r.stops.forEach(s => {
        if (s.lat && s.lng && s.status !== 'COMPLETED' && s.status !== 'FAILED') {
          allLatLngs.push([s.lat, s.lng])
        }
      })
    })
    drivers.forEach(d => {
      if (d.lat && d.lng && !d.has_route_today) allLatLngs.push([d.lat, d.lng])
    })
    if (allLatLngs.length > 1) {
      const bounds = L.latLngBounds(allLatLngs)
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    }
  }, [routes, drivers])

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
