import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * PATCH /api/logistics/stops/[id]/reassign
 * Body: { route_id: string }
 *
 * Move um LogisticsStop de uma rota pra outra (redistribuicao manual
 * entre motoristas). Valida:
 *  - Stop pertence a empresa do usuario
 *  - Nova rota pertence a mesma empresa
 *  - Ambas rotas no MESMO dia (regra operacional — nao move entre dias)
 *  - Stop ainda PENDING/EN_ROUTE/ARRIVED (nao move stop ja concluida)
 *
 * Efeito:
 *  - stop.route_id = novo
 *  - stop.sequence = (max sequence da nova rota) + 1
 *  - total_stops da rota antiga decrementa
 *  - total_stops da rota nova incrementa
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const newRouteId = String(body.route_id || '')
    if (!newRouteId) return error('route_id obrigatorio', 400)

    const stop = await prisma.logisticsStop.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { route: { select: { id: true, date: true, driver_id: true } } },
    })
    if (!stop) return error('Parada nao encontrada', 404)
    if (stop.status === 'COMPLETED' || stop.status === 'FAILED') {
      return error('Parada ja finalizada — nao pode ser movida', 400)
    }
    if (stop.route_id === newRouteId) {
      return error('Parada ja esta nessa rota', 400)
    }

    const newRoute = await prisma.logisticsRoute.findFirst({
      where: { id: newRouteId, company_id: user.companyId },
      select: { id: true, date: true, driver_id: true },
    })
    if (!newRoute) return error('Rota destino nao encontrada', 404)

    // Regra: so move entre rotas do MESMO dia. Pra mover pra outro dia,
    // o atendente deve duplicar o stop ou criar nova.
    const sameDay = new Date(stop.route.date).toISOString().slice(0, 10)
      === new Date(newRoute.date).toISOString().slice(0, 10)
    if (!sameDay) return error('Rotas de dias diferentes — nao e possivel mover', 400)

    const last = await prisma.logisticsStop.findFirst({
      where: { route_id: newRoute.id, company_id: user.companyId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    })
    const newSequence = (last?.sequence || 0) + 1

    await prisma.$transaction([
      prisma.logisticsStop.update({
        where: { id: stop.id },
        data: {
          route_id: newRoute.id,
          sequence: newSequence,
        },
      }),
      prisma.logisticsRoute.updateMany({
        where: { id: stop.route_id },
        data: { total_stops: { decrement: 1 } },
      }),
      prisma.logisticsRoute.updateMany({
        where: { id: newRoute.id },
        data: { total_stops: { increment: 1 } },
      }),
    ])

    // Invalida cache do plan das duas rotas (polyline vai recalcular)
    await prisma.setting.deleteMany({
      where: {
        company_id: user.companyId,
        key: { in: [`route-plan:${stop.route_id}`, `route-plan:${newRoute.id}`] },
      },
    }).catch(() => {})

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'reassign_stop',
      entityId: stop.id,
      newValue: {
        from_route: stop.route_id,
        to_route: newRoute.id,
        new_sequence: newSequence,
      } as any,
    })

    return success({
      stop_id: stop.id,
      new_route_id: newRoute.id,
      new_sequence: newSequence,
    })
  } catch (err) {
    return handleError(err)
  }
}
