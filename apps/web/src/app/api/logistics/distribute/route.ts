import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { ensureCustomersGeocoded } from '@/lib/geocoding'
import { balancedKMeans, densityKMeans, orderByPriority, classifyOrder } from '@/lib/clustering'
import { getCompanyHQ } from '@/lib/company-hq'

/**
 * POST /api/logistics/distribute
 *
 * Distribui um conjunto de OS entre N motoristas usando k-means
 * balanceado geograficamente. Reutiliza a mesma logica de selecao
 * do /lookup-os (numbers[] ou statuses[]), mas aceita uma lista
 * de driver_ids e divide em clusters.
 *
 * Input: {
 *   driver_ids: string[]   — IDs dos motoristas (2+)
 *   numbers?: number[]     — OS numbers a buscar
 *   statuses?: string[]    — nomes de status
 *   excluded_os_ids?: string[] — OS a excluir da distribuicao
 * }
 *
 * Output: {
 *   assignments: [
 *     { driver_id, driver_name, items: [OS enriquecidas na ordem otima] }
 *   ],
 *   balanced: boolean,
 *   geocoded_now: number,
 *   missing: number[]
 * }
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission('os', 'view')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const driverIds: string[] = Array.isArray(body.driver_ids) ? body.driver_ids.filter((s: any) => typeof s === 'string') : []
  const numbers: number[] = Array.isArray(body.numbers)
    ? body.numbers.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : []
  const statuses: string[] = Array.isArray(body.statuses)
    ? body.statuses.filter((s: any) => typeof s === 'string' && s.trim())
    : []
  const excludedIds: Set<string> = new Set(Array.isArray(body.excluded_os_ids) ? body.excluded_os_ids : [])

  if (driverIds.length < 2) {
    return NextResponse.json({ error: 'Selecione ao menos 2 motoristas' }, { status: 400 })
  }
  if (numbers.length === 0 && statuses.length === 0) {
    return NextResponse.json({ error: 'Informe numbers[] ou statuses[]' }, { status: 400 })
  }

  // Valida motoristas
  const drivers = await prisma.userProfile.findMany({
    where: { id: { in: driverIds }, company_id: auth.companyId, is_active: true },
    select: { id: true, name: true },
  })
  if (drivers.length !== driverIds.length) {
    return NextResponse.json({ error: 'Um ou mais motoristas invalidos' }, { status: 400 })
  }

  // Resolve statuses em IDs
  const statusFilter: string[] = []
  if (statuses.length > 0) {
    const ms = await prisma.moduleStatus.findMany({
      where: {
        company_id: auth.companyId,
        module: 'os',
        OR: statuses.map(s => ({ name: { contains: s, mode: 'insensitive' as const } })),
      },
      select: { id: true },
    })
    ms.forEach(s => statusFilter.push(s.id))
  }

  const where: any = { company_id: auth.companyId, deleted_at: null }
  const orClauses: any[] = []
  if (numbers.length > 0) orClauses.push({ os_number: { in: numbers } })
  if (statusFilter.length > 0) orClauses.push({ status_id: { in: statusFilter } })
  if (orClauses.length === 1) Object.assign(where, orClauses[0])
  else where.OR = orClauses

  const orders = await prisma.serviceOrder.findMany({
    where,
    include: {
      module_statuses: { select: { name: true } },
      customers: {
        select: {
          id: true, legal_name: true, trade_name: true,
          address_street: true, address_complement: true, address_number: true,
          address_neighborhood: true, address_city: true, address_state: true, address_zip: true,
          address_lat: true, address_lng: true,
          mobile: true, phone: true,
        },
      },
    },
    orderBy: { os_number: 'asc' },
    take: 300,
  })

  const foundNumbers = new Set(orders.map(o => o.os_number))
  const missing = numbers.filter(n => !foundNumbers.has(n))

  // Filtra exclusoes
  const filtered = orders.filter(o => !excludedIds.has(o.id))

  // Geocoda customers faltantes + resolve HQ em paralelo
  const customerIds = filtered.map(o => o.customers?.id).filter(Boolean) as string[]
  const [geocodedMap, hq] = await Promise.all([
    ensureCustomersGeocoded(customerIds),
    getCompanyHQ(auth.companyId),
  ])

  // Monta items pra clustering (com classificacao pra priorizacao)
  const items = filtered.map(os => {
    const c = os.customers
    const fullAddress = c
      ? [
          c.address_street,
          c.address_number ? `n° ${c.address_number}` : null,
          c.address_complement,
          c.address_neighborhood,
          c.address_city && c.address_state ? `${c.address_city}/${c.address_state}` : c.address_city,
          c.address_zip,
        ].filter(Boolean).join(', ')
      : ''
    const statusName = os.module_statuses?.name || ''
    const isColeta = /colet/i.test(statusName)
    const suggested_type = (isColeta ? 'COLETA' : 'ENTREGA') as 'COLETA' | 'ENTREGA'
    const freshCoords = c?.id ? geocodedMap.get(c.id) : null
    const lat = freshCoords?.lat ?? (c?.address_lat ? Number(c.address_lat) : null)
    const lng = freshCoords?.lng ?? (c?.address_lng ? Number(c.address_lng) : null)

    return {
      os_id: os.id,
      os_number: os.os_number,
      status: statusName,
      suggested_type,
      classification: classifyOrder(suggested_type, statusName),
      customer_id: c?.id || null,
      customer_name: c?.trade_name || c?.legal_name || '',
      customer_phone: c?.mobile || c?.phone || '',
      address: fullAddress,
      equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
      lat,
      lng,
    }
  })

  // Strategy: 'density' prioriza eficiencia (clusters densos com mais
  // paradas); 'balanced' mantem k-means antigo. Default = density.
  const strategy: 'density' | 'balanced' = body.strategy === 'balanced' ? 'balanced' : 'density'
  const result = strategy === 'density'
    ? densityKMeans(items, drivers.length, { startPoint: hq })
    : balancedKMeans(items, drivers.length, { startPoint: hq })

  // Aplica prioridade dentro de cada cluster:
  //   1. COLETAS (cliente esperando motorista buscar)
  //   2. ENTREGAS REPARADAS (equipamento pronto)
  //   3. Outras entregas (recusadas/negociar)
  result.assignments = result.assignments.map(cluster =>
    orderByPriority(cluster as any, hq),
  )

  // Monta resposta: mapeia cluster -> motorista na ordem fornecida
  const assignments = drivers.map((driver, idx) => ({
    driver_id: driver.id,
    driver_name: driver.name,
    items: result.assignments[idx] || [],
  }))

  return NextResponse.json({
    data: {
      assignments,
      strategy,
      balanced: result.balanced,
      iterations: result.iterations,
      geocoded_now: geocodedMap.size,
      missing,
      excluded_count: excludedIds.size,
      hq: hq ? { lat: hq.lat, lng: hq.lng, formatted: hq.formatted } : null,
    },
  })
}
