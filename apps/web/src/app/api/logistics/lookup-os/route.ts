import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { ensureCustomersGeocoded, nearestNeighborOrder } from '@/lib/geocoding'
import { getCompanyHQ } from '@/lib/company-hq'

/**
 * POST /api/logistics/lookup-os
 *
 * Faz bulk lookup de OS pra montar paradas de rota automaticamente.
 * Aceita 2 modos (pode combinar):
 *   - numbers: Array<number>  — lista de OS numbers (colar e extrair regex)
 *   - statuses: Array<string> — nomes de status (ex: ['Coletar', 'Entregar Reparado'])
 *
 * Retorna cada OS com: numero, cliente, endereco formatado, equipamento,
 * tipo sugerido (COLETA/ENTREGA baseado no status) e o status atual.
 *
 * NAO altera nada — endpoint read-only usado pela UI de "Nova Rota".
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission('os', 'view')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const numbers: number[] = Array.isArray(body.numbers)
    ? body.numbers.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : []
  const statuses: string[] = Array.isArray(body.statuses)
    ? body.statuses.filter((s: any) => typeof s === 'string' && s.trim())
    : []

  if (numbers.length === 0 && statuses.length === 0) {
    return NextResponse.json({ error: 'Informe numbers[] ou statuses[]' }, { status: 400 })
  }

  // Resolve statuses into module_status IDs (names podem variar entre empresas)
  const statusFilter: string[] = []
  if (statuses.length > 0) {
    const moduleStatuses = await prisma.moduleStatus.findMany({
      where: {
        company_id: auth.companyId,
        module: 'os',
        OR: statuses.map(s => ({ name: { contains: s, mode: 'insensitive' as const } })),
      },
      select: { id: true, name: true },
    })
    moduleStatuses.forEach(s => statusFilter.push(s.id))
  }

  const where: any = {
    company_id: auth.companyId,
    deleted_at: null,
    // Rota e apenas pra OS com atendimento externo (motorista vai buscar).
    // OS de LOJA (cliente trouxe no balcao) nao precisam. Passe
    // include_internal=true pra sobrescrever em casos especiais.
    ...(body.include_internal ? {} : { os_location: 'EXTERNO' }),
  }
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
    take: 200,
  })

  // Also identify which requested numbers weren't found (pra UI avisar)
  const foundNumbers = new Set(orders.map(o => o.os_number))
  const missing = numbers.filter(n => !foundNumbers.has(n))

  // Se o user digitou numeros e algumas foram filtradas por serem LOJA
  // (atendimento no balcao), buscar esses separado pra devolver aviso
  // util na UI: 'OS 60123 e de LOJA — motorista nao vai buscar'.
  let filteredInternal: { os_number: number; location: string | null }[] = []
  if (numbers.length > 0 && missing.length > 0 && !body.include_internal) {
    const internalHits = await prisma.serviceOrder.findMany({
      where: {
        company_id: auth.companyId,
        deleted_at: null,
        os_number: { in: missing },
        os_location: { not: 'EXTERNO' },
      },
      select: { os_number: true, os_location: true },
    })
    filteredInternal = internalHits.map(o => ({ os_number: o.os_number, location: o.os_location }))
  }

  // Geocoda customers que ainda não têm lat/lng (cache infinito no DB).
  // Só faz network call na primeira vez que o cliente aparece numa rota.
  const wantsSort = body.order === 'nearest'
  let geocodedMap = new Map<string, { lat: number; lng: number }>()
  let hq: { lat: number; lng: number; formatted: string } | null = null
  if (wantsSort) {
    const customerIds = orders.map(o => o.customers?.id).filter(Boolean) as string[]
    // Paraleliza: geocoda clientes e resolve HQ ao mesmo tempo
    const [geocoded, hqResolved] = await Promise.all([
      ensureCustomersGeocoded(customerIds),
      getCompanyHQ(auth.companyId),
    ])
    geocodedMap = geocoded
    hq = hqResolved
  }

  const items = orders.map(os => {
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
    const suggestedType: 'COLETA' | 'ENTREGA' = isColeta ? 'COLETA' : 'ENTREGA'

    // Coords: prefere cache fresh do geocoder, senão o que já tinha no DB
    const freshCoords = c?.id ? geocodedMap.get(c.id) : null
    const lat = freshCoords?.lat ?? (c?.address_lat ? Number(c.address_lat) : null)
    const lng = freshCoords?.lng ?? (c?.address_lng ? Number(c.address_lng) : null)

    return {
      os_id: os.id,
      os_number: os.os_number,
      os_location: os.os_location || null,
      status: statusName,
      suggested_type: suggestedType,
      customer_id: c?.id || null,
      customer_name: c?.trade_name || c?.legal_name || '',
      customer_phone: c?.mobile || c?.phone || '',
      address: fullAddress,
      equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
      lat,
      lng,
      // fallback ordering keys (quando não tiver lat/lng disponível)
      _city: (c?.address_city || '').toLowerCase().trim(),
      _neighborhood: (c?.address_neighborhood || '').toLowerCase().trim(),
      _zip: (c?.address_zip || '').replace(/\D/g, ''),
    }
  })

  let sortedItems = items
  let sortMethod: 'haversine' | 'lexicographic' | 'none' = 'none'
  if (wantsSort) {
    const haveCoordsCount = items.filter(i => i.lat !== null && i.lng !== null).length
    const ratio = haveCoordsCount / Math.max(items.length, 1)
    if (ratio >= 0.6) {
      // Tem lat/lng pra maioria → nearest-neighbor real partindo da SEDE
      // da empresa (se configurada) — garante que motorista sempre comeca
      // do ponto certo e volta pra fazer a ultima parada mais perto dali
      sortedItems = nearestNeighborOrder(items, hq)
      sortMethod = 'haversine'
    } else {
      // Fallback: ordenação lexicográfica por cidade → bairro → CEP
      sortedItems = [...items].sort((a, b) => {
        if (a._city !== b._city) return a._city.localeCompare(b._city)
        if (a._neighborhood !== b._neighborhood) return a._neighborhood.localeCompare(b._neighborhood)
        if (a._zip !== b._zip) return a._zip.localeCompare(b._zip)
        if (a.suggested_type !== b.suggested_type) return a.suggested_type === 'COLETA' ? -1 : 1
        return a.os_number - b.os_number
      })
      sortMethod = 'lexicographic'
    }
  }

  // Remove campos internos antes de retornar
  const cleanItems = sortedItems.map(({ _city, _neighborhood, _zip, ...rest }) => rest)

  // Missing real = nao encontradas OU filtradas por localizacao interna
  const filteredInternalSet = new Set(filteredInternal.map(f => f.os_number))
  const missingReal = missing.filter(n => !filteredInternalSet.has(n))

  return NextResponse.json({
    data: {
      items: cleanItems,
      missing: missingReal,
      filtered_internal: filteredInternal, // [{ os_number, location }]
      total: cleanItems.length,
      ordered: wantsSort,
      sort_method: sortMethod,
      geocoded_now: geocodedMap.size,
      hq: hq ? { lat: hq.lat, lng: hq.lng } : null,
    },
  })
}
