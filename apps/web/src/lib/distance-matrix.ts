import 'server-only'

/**
 * Wrapper do Google Distance Matrix API com cache em memoria.
 *
 * Estrategia:
 *  - Cache key = origin (lat,lng arredondado 3 casas) + dest (mesmo) + modo
 *  - TTL 5 min — trafego muda, mas nao tao rapido. 5min e bom equilibrio
 *    entre frescor e custo (Distance Matrix custa $5/1000 elementos)
 *  - Fail-silently quando key nao configurada — frontend mostra ETA via
 *    haversine simples (15-25 km/h SP urbano)
 *
 * Uso: ETA do motorista pra proxima parada da rota.
 */

type DistanceResult = {
  distance_m: number
  duration_s: number  // duration in seconds (with traffic if available)
  source: 'google' | 'haversine'
}

function getKey(): string | null {
  return process.env.GOOGLE_DISTANCE_MATRIX_API_KEY
    || process.env.GOOGLE_GEOCODING_API_KEY
    || process.env.GOOGLE_VISION_API_KEY
    || null
}

const cache = new Map<string, { result: DistanceResult; expiresAt: number }>()
const TTL_MS = 5 * 60 * 1000

function cacheKey(o: { lat: number; lng: number }, d: { lat: number; lng: number }): string {
  // Arredonda pra 3 casas (~111m precision) — agrupa requests vizinhos
  const r = (n: number) => n.toFixed(3)
  return `${r(o.lat)},${r(o.lng)}->${r(d.lat)},${r(d.lng)}`
}

/**
 * Calcula distancia + tempo entre 2 pontos. Usa Distance Matrix (com
 * trafego em tempo real) se key configurada, senao haversine + 20km/h.
 */
export async function getDistanceAndDuration(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<DistanceResult> {
  const k = cacheKey(origin, destination)
  const cached = cache.get(k)
  if (cached && cached.expiresAt > Date.now()) return cached.result

  const apiKey = getKey()
  if (!apiKey) {
    // Fallback haversine: distancia direta * 1.4 (fator de detour urbano) / 20km/h
    const distM = haversineMeters(origin, destination)
    const result: DistanceResult = {
      distance_m: Math.round(distM * 1.4),
      duration_s: Math.round((distM * 1.4 / 1000) / 20 * 3600),
      source: 'haversine',
    }
    cache.set(k, { result, expiresAt: Date.now() + TTL_MS })
    return result
  }

  try {
    // Usa Routes API (moderna) em vez de Distance Matrix (legacy/deprecated).
    // Routes API e habilitada por default em projetos GCP novos, mais barata,
    // e suporta FieldMask pra economizar custos (so cobra pelos campos pedidos).
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Mask essencial — sem isso Google retorna 400. Pede so os 2 campos
        // que a gente usa (distance+duration), minimizando custo.
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
        computeAlternativeRoutes: false,
        languageCode: 'pt-BR',
        regionCode: 'BR',
        units: 'METRIC',
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`)
    const data = await res.json()
    const route = data.routes?.[0]
    if (!route) throw new Error('no route in response')

    // duration vem como string tipo "123s"
    const durationStr: string = route.duration || '0s'
    const durationS = parseInt(durationStr.replace('s', '')) || 0

    const result: DistanceResult = {
      distance_m: route.distanceMeters || 0,
      duration_s: durationS,
      source: 'google',
    }
    cache.set(k, { result, expiresAt: Date.now() + TTL_MS })
    return result
  } catch (e) {
    console.warn('[distance-matrix] fallback haversine:', (e as Error).message)
    const distM = haversineMeters(origin, destination)
    const result: DistanceResult = {
      distance_m: Math.round(distM * 1.4),
      duration_s: Math.round((distM * 1.4 / 1000) / 20 * 3600),
      source: 'haversine',
    }
    cache.set(k, { result, expiresAt: Date.now() + TTL_MS })
    return result
  }
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
