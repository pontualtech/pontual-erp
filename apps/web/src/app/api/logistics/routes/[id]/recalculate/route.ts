import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { ensureCustomersGeocoded, nearestNeighborOrder, geocodeAddress } from '@/lib/geocoding'
import { getCompanyHQ } from '@/lib/company-hq'

type Params = { params: { id: string } }

/**
 * POST /api/logistics/routes/[id]/recalculate
 *
 * Reordena paradas PENDING da rota pelo nearest-neighbor partindo da
 * sede da empresa. Paradas COMPLETED/FAILED/ARRIVED ficam intocadas —
 * so o que ainda nao foi feito e reorganizado.
 *
 * Casos de uso:
 *   - Operador adicionou paradas novas via "Adicionar parada" e quer
 *     reotimizar a ordem
 *   - Motorista adiou varias paradas e a sequencia original nao faz
 *     mais sentido
 *   - Rota foi criada manualmente sem "Ordenar por proximidade"
 *
 * Efeito colateral: geocoda paradas avulsas que ainda nao tem lat/lng.
 *
 * Autorizacao: os.edit
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const route = await prisma.logisticsRoute.findFirst({
      where: { id: params.id, company_id: user.companyId },
      select: { id: true, status: true },
    })
    if (!route) return error('Rota nao encontrada', 404)
    if (route.status === 'COMPLETED') return error('Rota ja finalizada', 400)

    // Busca paradas pendentes + finalizadas (pra preservar a sequencia
    // delas)
    const allStops = await prisma.logisticsStop.findMany({
      where: { route_id: route.id, company_id: user.companyId },
      orderBy: { sequence: 'asc' },
    })
    const pending = allStops.filter(s => s.status === 'PENDING')
    const frozen = allStops.filter(s => s.status !== 'PENDING')

    if (pending.length < 2) {
      return success({ reordered: 0, message: 'Menos de 2 paradas pendentes — nada a reordenar' })
    }

    // 1. Geocoda avulsos (address sem lat/lng)
    let geocodedCount = 0
    for (const s of pending) {
      if (s.lat && s.lng) continue
      if (!s.address) continue
      try {
        const coords = await geocodeAddress(String(s.address))
        if (coords) {
          await prisma.logisticsStop.update({
            where: { id: s.id },
            data: { lat: coords.lat, lng: coords.lng },
          })
          s.lat = coords.lat as any
          s.lng = coords.lng as any
          geocodedCount++
        }
      } catch { /* continua */ }
    }

    // 2. Se stops tem os_id, atualiza lat/lng via customer (cache)
    const osIds = pending.map(s => s.os_id).filter(Boolean) as string[]
    if (osIds.length > 0) {
      const orders = await prisma.serviceOrder.findMany({
        where: { id: { in: osIds }, company_id: user.companyId },
        select: { id: true, customer_id: true },
      })
      const customerIds = orders.map(o => o.customer_id).filter(Boolean) as string[]
      if (customerIds.length > 0) await ensureCustomersGeocoded(customerIds)
    }

    // 3. HQ como start point
    const hq = await getCompanyHQ(user.companyId)

    // 4. Nearest-neighbor
    const items = pending.map(s => ({
      id: s.id,
      lat: s.lat ? Number(s.lat) : null,
      lng: s.lng ? Number(s.lng) : null,
    }))
    const ordered = nearestNeighborOrder(items, hq)

    // 5. Reassinalar sequence: paradas frozen mantem sequence,
    // pendentes pegam novas sequences apos a maior frozen
    const maxFrozen = frozen.length > 0 ? Math.max(...frozen.map(f => f.sequence)) : 0
    const updates: { id: string; newSeq: number }[] = []
    ordered.forEach((item, idx) => {
      updates.push({ id: item.id, newSeq: maxFrozen + idx + 1 })
    })

    // Executa em transacao — primeiro shifta todas pra negativo pra
    // evitar colisoes de unique (se houver), depois setamos as corretas
    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.logisticsStop.update({
          where: { id: u.id },
          data: { sequence: -(u.newSeq + 100_000) }, // tempo negativo
        })
      }
      for (const u of updates) {
        await tx.logisticsStop.update({
          where: { id: u.id },
          data: { sequence: u.newSeq },
        })
      }
    })

    logAudit({
      companyId: user.companyId, userId: user.id,
      module: 'logistics', action: 'recalculate_route',
      entityId: route.id,
      newValue: { reordered: updates.length, geocoded_now: geocodedCount, hq_used: !!hq },
    })

    return success({
      reordered: updates.length,
      geocoded_now: geocodedCount,
      hq_used: !!hq,
      sort_method: hq ? 'haversine_from_hq' : 'haversine_centroid',
    })
  } catch (err) {
    return handleError(err)
  }
}
