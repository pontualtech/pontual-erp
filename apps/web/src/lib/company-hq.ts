import 'server-only'
import { prisma } from '@pontual/db'
import { geocodeAddress } from './geocoding'

/**
 * Resolve o ponto de partida (sede da empresa) pra calculos de rota.
 *
 * Le endereco das settings (mesmas keys usadas em /config/empresa),
 * geocoda na primeira vez, cacheia lat/lng em settings dedicadas
 * (geocoding.hq_lat, geocoding.hq_lng) pra nao bater no Google toda
 * hora.
 *
 * Retorna null se:
 *   - Empresa nao configurou endereco ainda
 *   - Geocoding falhou (chave invalida, endereco ambiguo)
 * Nesse caso, o consumidor deve fazer fallback pro centroide dos items.
 *
 * Cache invalidation: quando empresa editar endereco em /config/empresa,
 * /api/settings/empresa-config deleta geocoding.hq_* pra forcar regeocode
 * na proxima chamada. (TODO: implementar quando for relevante)
 */
export async function getCompanyHQ(companyId: string): Promise<{ lat: number; lng: number; formatted: string } | null> {
  const keys = [
    'cnab.endereco', 'company.number', 'company.complemento',
    'cnab.bairro', 'cnab.cidade', 'cnab.uf', 'cnab.cep',
    'geocoding.hq_lat', 'geocoding.hq_lng',
  ]
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { in: keys } },
    select: { key: true, value: true },
  })
  const m = new Map(settings.map(s => [s.key, s.value]))

  // Cache hit: ja temos lat/lng
  const cachedLat = m.get('geocoding.hq_lat')
  const cachedLng = m.get('geocoding.hq_lng')
  if (cachedLat && cachedLng) {
    const lat = Number(cachedLat)
    const lng = Number(cachedLng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, formatted: formatAddress(m) }
    }
  }

  // Cache miss — geocoda
  const address = formatAddress(m)
  if (!address || address.length < 15) return null

  const coords = await geocodeAddress(address)
  if (!coords) return null

  // Persiste no cache
  await Promise.all([
    prisma.setting.upsert({
      where: { company_id_key: { company_id: companyId, key: 'geocoding.hq_lat' } },
      update: { value: String(coords.lat) },
      create: { company_id: companyId, key: 'geocoding.hq_lat', value: String(coords.lat), type: 'number' },
    }),
    prisma.setting.upsert({
      where: { company_id_key: { company_id: companyId, key: 'geocoding.hq_lng' } },
      update: { value: String(coords.lng) },
      create: { company_id: companyId, key: 'geocoding.hq_lng', value: String(coords.lng), type: 'number' },
    }),
  ])

  return { lat: coords.lat, lng: coords.lng, formatted: address }
}

function formatAddress(m: Map<string, string>): string {
  const parts = [
    m.get('cnab.endereco'),
    m.get('company.number'),
    m.get('company.complemento'),
    m.get('cnab.bairro'),
    m.get('cnab.cidade'),
    m.get('cnab.uf'),
    m.get('cnab.cep'),
    'Brasil',
  ].filter(Boolean)
  return parts.join(', ')
}
