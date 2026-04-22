import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { geocodeAddress } from '@/lib/geocoding'

type Params = { params: { id: string } }

/**
 * POST /api/logistics/routes/[id]/stops
 *
 * Adiciona uma nova parada em rota ja existente (em PLANNED ou
 * IN_PROGRESS). Util pra operador que precisa incluir cliente/endereco
 * novo sem recriar a rota inteira.
 *
 * Body: {
 *   type: 'COLETA'|'ENTREGA',
 *   customer_name: string,
 *   address: string,           // pode ser avulso (sem OS)
 *   customer_phone?, complement?, os_id?, lat?, lng?,
 *   insert_at_end?: boolean    // true (default) = fim da lista
 * }
 *
 * Geocoda endereco automaticamente se lat/lng nao fornecidos.
 * Nova parada entra PENDING, sequence = max + 1.
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
    if (route.status === 'COMPLETED') return error('Rota ja finalizada — nao pode adicionar paradas', 400)

    const body = await req.json()
    if (!body.address) return error('address e obrigatorio', 400)
    if (!body.type || !['COLETA', 'ENTREGA'].includes(body.type)) return error('type deve ser COLETA ou ENTREGA', 400)

    // Geocoda se necessario
    let lat = body.lat ?? null
    let lng = body.lng ?? null
    if ((!lat || !lng) && body.address) {
      try {
        const coords = await geocodeAddress(body.address)
        if (coords) { lat = coords.lat; lng = coords.lng }
      } catch { /* fallback silencioso */ }
    }

    // Sequence = max atual + 1
    const maxSeq = await prisma.logisticsStop.findFirst({
      where: { route_id: route.id, company_id: user.companyId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    })
    const newSeq = (maxSeq?.sequence ?? 0) + 1

    const created = await prisma.$transaction(async (tx) => {
      const stop = await tx.logisticsStop.create({
        data: {
          company_id: user.companyId,
          route_id: route.id,
          type: body.type,
          sequence: newSeq,
          status: 'PENDING',
          os_id: body.os_id || null,
          customer_name: body.customer_name || null,
          customer_phone: body.customer_phone || null,
          address: body.address,
          address_complement: body.address_complement || null,
          lat, lng,
          notes: body.notes || null,
        },
      })
      await tx.logisticsRoute.update({
        where: { id: route.id },
        data: { total_stops: { increment: 1 } },
      })
      return stop
    })

    logAudit({
      companyId: user.companyId, userId: user.id,
      module: 'logistics', action: 'add_stop',
      entityId: created.id,
      newValue: { route_id: route.id, sequence: newSeq, address: body.address },
    })

    return success({ id: created.id, sequence: created.sequence, lat: created.lat, lng: created.lng, geocoded: !!(lat && lng) }, 201)
  } catch (err) {
    return handleError(err)
  }
}
