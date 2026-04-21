import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    // ?force=1 permite encerrar rota com paradas pendentes (operador decide
    // cancelar visitas que nao aconteceram). As pendentes viram FAILED.
    const force = req.nextUrl.searchParams.get('force') === '1'

    const route = await prisma.logisticsRoute.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { stops: true },
    })
    if (!route) return error('Rota não encontrada', 404)

    if (route.status === 'COMPLETED') return error('Rota já foi concluída', 422)

    const pendingStops = route.stops.filter(
      (s) => s.status !== 'COMPLETED' && s.status !== 'FAILED'
    )

    if (pendingStops.length > 0) {
      if (!force) {
        return error(
          `Ainda há ${pendingStops.length} parada(s) pendente(s). Conclua/marque como falha primeiro OU use 'forçar conclusão' para cancelar as pendentes.`,
          422
        )
      }
      // Forced: marca todas pendentes como FAILED com motivo
      await prisma.logisticsStop.updateMany({
        where: { route_id: params.id, company_id: user.companyId, status: { notIn: ['COMPLETED', 'FAILED'] } },
        data: { status: 'FAILED', failure_reason: 'Cancelada no encerramento da rota pelo operador', completed_at: new Date() },
      })
    }

    const updated = await prisma.logisticsRoute.update({
      where: { id: params.id, company_id: user.companyId },
      data: {
        status: 'COMPLETED',
        completed_at: new Date(),
        updated_at: new Date(),
      },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        driver: { select: { id: true, name: true } },
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'complete_route',
      entityId: params.id,
      newValue: {
        total_stops: route.total_stops,
        completed_stops: route.completed_stops,
      },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
