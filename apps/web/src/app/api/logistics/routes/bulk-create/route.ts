import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/logistics/routes/bulk-create
 *
 * Cria multiplas rotas numa unica transacao. Usado depois do
 * /api/logistics/distribute pra persistir o resultado da distribuicao
 * entre motoristas.
 *
 * Input: {
 *   date: string,  // YYYY-MM-DD
 *   notes?: string,
 *   assignments: [
 *     { driver_id, stops: [{ os_id, type, sequence, customer_name, ... }] }
 *   ]
 * }
 *
 * Output: { routes: [{ id, driver_id, stops_count }], total_routes }
 *
 * Atomicidade: se uma rota falhar, nenhuma e criada. Evita estado
 * inconsistente tipo "metade dos motoristas recebeu rota".
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const { date, notes, assignments } = body

    if (!date) return error('Data e obrigatoria', 400)
    if (!Array.isArray(assignments) || assignments.length < 1) {
      return error('Ao menos uma atribuicao e necessaria', 400)
    }

    // Valida: motoristas unicos e existem
    const driverIds = assignments.map((a: any) => a.driver_id).filter(Boolean)
    const uniqueDriverIds = new Set(driverIds)
    if (uniqueDriverIds.size !== driverIds.length) {
      return error('Motoristas duplicados na distribuicao', 400)
    }
    const drivers = await prisma.userProfile.findMany({
      where: { id: { in: driverIds }, company_id: user.companyId, is_active: true },
      select: { id: true, name: true },
    })
    if (drivers.length !== driverIds.length) return error('Motorista invalido', 400)

    // Filtra atribuicoes com 0 stops — motorista que nao recebeu nada
    // nao ganha rota vazia. Se todos tiverem 0, retorna erro.
    const nonEmpty = assignments.filter((a: any) => Array.isArray(a.stops) && a.stops.length > 0)
    if (nonEmpty.length === 0) return error('Nenhuma parada em nenhuma rota', 400)

    const routes = await prisma.$transaction(async (tx) => {
      const created: { id: string; driver_id: string; stops_count: number }[] = []

      for (const a of nonEmpty) {
        const route = await tx.logisticsRoute.create({
          data: {
            company_id: user.companyId,
            driver_id: a.driver_id,
            date: new Date(date),
            status: 'PLANNED',
            total_stops: a.stops.length,
            completed_stops: 0,
            notes: notes || null,
          },
        })
        const stopsData = a.stops.map((stop: any, index: number) => ({
          company_id: user.companyId,
          route_id: route.id,
          os_id: stop.os_id || null,
          type: stop.type,
          sequence: stop.sequence ?? index + 1,
          status: 'PENDING',
          customer_name: stop.customer_name || null,
          customer_phone: stop.customer_phone || null,
          address: stop.address,
          address_complement: stop.address_complement || null,
          lat: stop.lat ?? null,
          lng: stop.lng ?? null,
          scheduled_window_start: stop.scheduled_window_start || null,
          scheduled_window_end: stop.scheduled_window_end || null,
          notes: stop.notes || null,
        }))
        await tx.logisticsStop.createMany({ data: stopsData })
        created.push({ id: route.id, driver_id: a.driver_id, stops_count: a.stops.length })
      }

      return created
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'bulk_create_routes',
      entityId: routes.map(r => r.id).join(','),
      newValue: { date, total_routes: routes.length, total_stops: routes.reduce((s, r) => s + r.stops_count, 0) },
    })

    return success({ routes, total_routes: routes.length }, 201)
  } catch (err) {
    return handleError(err)
  }
}
