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

    const route = await prisma.logisticsRoute.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { stops: true },
    })
    if (!route) return error('Rota não encontrada', 404)

    if (route.status === 'COMPLETED') return error('Rota já foi concluída', 422)

    // Verify all stops are COMPLETED or FAILED
    const pendingStops = route.stops.filter(
      (s) => s.status !== 'COMPLETED' && s.status !== 'FAILED'
    )
    if (pendingStops.length > 0) {
      return error(
        `Ainda há ${pendingStops.length} parada(s) pendente(s). Conclua ou marque como falha antes de finalizar a rota.`,
        422
      )
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
