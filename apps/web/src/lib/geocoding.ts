import 'server-only'
import { prisma } from '@pontual/db'

/**
 * Google Geocoding API wrapper com cache permanente no DB.
 *
 * Estratégia:
 *  - Cada Customer tem address_lat/lng persistidos (cache infinito).
 *  - Chamamos o Google só na PRIMEIRA vez que um cliente aparece numa
 *    rota OU se o endereço foi editado (geocode_stale).
 *  - Reutilizamos GOOGLE_VISION_API_KEY pra não criar mais env. Se você
 *    quiser separar, troque por GOOGLE_GEOCODING_API_KEY quando existir.
 *  - Silenciosamente falha quando a key não está configurada — ordenação
 *    cai no fallback lexicográfico (bairro/CEP).
 *
 * Custo: ~$5 / 1000 calls. Pra 500 clientes = $2.50 uma vez. Depois
 * zero custo até alguém editar endereço.
 */

function getKey(): string | null {
  return process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_VISION_API_KEY || null
}

function buildAddress(c: {
  address_street?: string | null
  address_number?: string | null
  address_neighborhood?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
}): string {
  // Monta string endereço pra Geocoding — "Rua X, 123, Bairro, Cidade, UF, CEP, Brasil"
  return [
    c.address_street,
    c.address_number,
    c.address_neighborhood,
    c.address_city,
    c.address_state,
    c.address_zip,
    'Brasil',
  ].filter(Boolean).join(', ')
}

/**
 * Geocoda um único endereço. Retorna {lat, lng} ou null.
 * NÃO atualiza o DB — use geocodeCustomer pra isso.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = getKey()
  if (!key || !address || address.length < 8) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=br&key=${key}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const data = await res.json()
    if (data.status !== 'OK' || !data.results?.length) return null
    const loc = data.results[0].geometry?.location
    if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null
    return { lat: loc.lat, lng: loc.lng }
  } catch { return null }
}

/**
 * Garante que o customer tem address_lat/lng. Se já tem cache, retorna.
 * Senão geocoda e persiste. Retorna null se tudo falhar.
 */
export async function ensureCustomerGeocoded(customerId: string): Promise<{ lat: number; lng: number } | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      address_lat: true, address_lng: true,
      address_street: true, address_number: true,
      address_neighborhood: true, address_city: true,
      address_state: true, address_zip: true,
    },
  })
  if (!customer) return null
  if (customer.address_lat && customer.address_lng) {
    return { lat: Number(customer.address_lat), lng: Number(customer.address_lng) }
  }

  const addr = buildAddress(customer)
  const coords = await geocodeAddress(addr)
  if (!coords) return null

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      address_lat: coords.lat,
      address_lng: coords.lng,
      address_geocoded_at: new Date(),
    },
  })
  return coords
}

/**
 * Geocoda uma lista de customers em paralelo (concorrência limitada pra
 * não estourar quota). Retorna Map<customer_id, {lat, lng}>.
 */
export async function ensureCustomersGeocoded(
  customerIds: string[],
  concurrency = 5,
): Promise<Map<string, { lat: number; lng: number }>> {
  const map = new Map<string, { lat: number; lng: number }>()
  const ids = Array.from(new Set(customerIds.filter(Boolean)))

  // Processa em batches pra respeitar concorrência
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(id => ensureCustomerGeocoded(id)))
    batch.forEach((id, idx) => {
      const r = results[idx]
      if (r) map.set(id, r)
    })
  }
  return map
}

/** Distância Haversine em km entre dois pontos. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Nearest-neighbor TSP aproximado a partir do ponto inicial.
 * Retorna a ordem ótima aproximada dos items (O(n²)).
 * Items sem coords ficam no fim da lista na ordem original.
 */
export function nearestNeighborOrder<T extends { lat: number | null; lng: number | null }>(
  items: T[],
  start: { lat: number; lng: number } | null = null,
): T[] {
  const withCoords = items.filter(i => i.lat !== null && i.lng !== null) as (T & { lat: number; lng: number })[]
  const withoutCoords = items.filter(i => i.lat === null || i.lng === null)

  if (withCoords.length === 0) return items
  const remaining = [...withCoords]
  const result: (T & { lat: number; lng: number })[] = []

  // Se não houver ponto inicial, usa o cluster centróide como aproximação
  let cursor: { lat: number; lng: number } = start || {
    lat: withCoords.reduce((s, x) => s + x.lat, 0) / withCoords.length,
    lng: withCoords.reduce((s, x) => s + x.lng, 0) / withCoords.length,
  }

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cursor, { lat: remaining[i].lat, lng: remaining[i].lng })
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    const next = remaining.splice(bestIdx, 1)[0]
    result.push(next)
    cursor = { lat: next.lat, lng: next.lng }
  }

  return [...result, ...withoutCoords]
}
