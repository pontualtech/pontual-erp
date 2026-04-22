import 'server-only'

/**
 * Wrapper da Google Routes API v2 — computeRoutes com waypoints.
 * Retorna polyline encoded (formato Google) + legs (distancia/tempo
 * de cada trecho) + totais da rota completa.
 *
 * Esta e a api nova da Google (substitui Directions API legada).
 * Preco: $5/1000 chamadas no plan Basic — cachear resultado e
 * importante. Rotas raramente mudam depois de planejadas, entao
 * TTL longo (24h) e OK.
 *
 * Docs: https://developers.google.com/maps/documentation/routes
 */

export type RouteLeg = {
  distance_m: number
  duration_s: number
  from_stop_id: string
  to_stop_id: string
}

export type RoutePlan = {
  polyline: string        // polyline do 1o batch (compat)
  polylines: string[]     // todos os batches — usa esse no frontend
  total_distance_m: number
  total_duration_s: number
  legs: RouteLeg[]
  source: 'google' | 'haversine'
}

// Google Routes API v2 Basic: max 25 intermediates por request.
// Rotas maiores sao divididas em batches com overlap de 1 waypoint.
const MAX_INTERMEDIATES_PER_CALL = 25

type Waypoint = {
  stop_id: string
  lat: number
  lng: number
}

function getKey(): string | null {
  return process.env.GOOGLE_DISTANCE_MATRIX_API_KEY
    || process.env.GOOGLE_GEOCODING_API_KEY
    || process.env.GOOGLE_VISION_API_KEY
    || null
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lng - a.lng) * Math.PI / 180
  const la1 = a.lat * Math.PI / 180
  const la2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/**
 * Calcula rota otima pelas ruas. Waypoints em ordem (origem ->
 * paradas intermediarias -> destino). Min 2 pontos.
 *
 * Rotas com >25 intermediarios sao divididas em batches (limite
 * do Google Routes API Basic). Legs e totais sao concatenados,
 * polyline e devolvida como array (polylines) alem de string.
 *
 * Fallback Haversine se API key ausente OU em caso de erro.
 */
export async function computeRoutePlan(waypoints: Waypoint[]): Promise<RoutePlan> {
  if (waypoints.length < 2) {
    return { polyline: '', polylines: [], total_distance_m: 0, total_duration_s: 0, legs: [], source: 'haversine' }
  }

  const apiKey = getKey()
  if (!apiKey) return fallbackHaversine(waypoints)

  // Quebra em batches: cada batch tem ate MAX_INTERMEDIATES_PER_CALL
  // waypoints intermediarios. Overlap de 1 ponto entre batches mantem
  // a continuidade — o destino do batch N vira origem do batch N+1.
  const batches: Waypoint[][] = []
  const stepStops = MAX_INTERMEDIATES_PER_CALL + 1 // +1 = destino do batch
  let cursor = 0
  while (cursor < waypoints.length - 1) {
    const end = Math.min(cursor + stepStops, waypoints.length - 1)
    batches.push(waypoints.slice(cursor, end + 1))
    cursor = end
  }

  const polylines: string[] = []
  const legs: RouteLeg[] = []
  let totalDist = 0
  let totalDur = 0

  for (const batch of batches) {
    const one = await fetchBatch(apiKey, batch)
    if (!one) return fallbackHaversine(waypoints) // qualquer falha -> degrada rota inteira
    if (one.polyline) polylines.push(one.polyline)
    legs.push(...one.legs)
    totalDist += one.distance_m
    totalDur += one.duration_s
  }

  return {
    polyline: polylines[0] || '',
    polylines,
    total_distance_m: totalDist,
    total_duration_s: totalDur,
    legs,
    source: 'google',
  }
}

/** Uma chamada Google Routes para um batch de <=26 waypoints. */
async function fetchBatch(apiKey: string, wp: Waypoint[]): Promise<{
  polyline: string; distance_m: number; duration_s: number; legs: RouteLeg[]
} | null> {
  const origin = wp[0]
  const destination = wp[wp.length - 1]
  const intermediates = wp.slice(1, -1)
  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    intermediates: intermediates.map(p => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    languageCode: 'pt-BR',
    units: 'METRIC',
  }

  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error('[Routes API] HTTP', res.status, err.slice(0, 300))
      return null
    }
    const data = await res.json()
    const route = data.routes?.[0]
    if (!route) return null
    const apiLegs: any[] = route.legs || []
    const legs: RouteLeg[] = apiLegs.map((leg: any, i: number) => ({
      distance_m: Number(leg.distanceMeters) || 0,
      duration_s: parseDurationSeconds(leg.duration),
      from_stop_id: wp[i].stop_id,
      to_stop_id: wp[i + 1].stop_id,
    }))
    return {
      polyline: route.polyline?.encodedPolyline || '',
      distance_m: Number(route.distanceMeters) || 0,
      duration_s: parseDurationSeconds(route.duration),
      legs,
    }
  } catch (err) {
    console.error('[Routes API] Failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

/** Google devolve duration como "123s" ou "1234.5s". */
function parseDurationSeconds(s: any): number {
  if (!s) return 0
  const match = String(s).match(/^([\d.]+)s?$/)
  return match ? Math.round(parseFloat(match[1])) : 0
}

/** Fallback quando API indisponivel: linhas retas * 1.4 (detour urbano). */
function fallbackHaversine(waypoints: Waypoint[]): RoutePlan {
  const legs: RouteLeg[] = []
  let total = 0
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]; const b = waypoints[i + 1]
    const straight = haversineM(a, b)
    const distM = Math.round(straight * 1.4)
    const durS = Math.round((distM / 1000) / 20 * 3600) // 20km/h urbano
    legs.push({
      distance_m: distM, duration_s: durS,
      from_stop_id: a.stop_id, to_stop_id: b.stop_id,
    })
    total += distM
  }
  return {
    polyline: '', // sem polyline real no fallback — frontend usa linha reta
    polylines: [],
    total_distance_m: total,
    total_duration_s: legs.reduce((s, l) => s + l.duration_s, 0),
    legs,
    source: 'haversine',
  }
}
