import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string; stopId: string } }

/**
 * PATCH /api/logistics/routes/[id]/stops/[stopId]/move
 * body: { direction: 'up' | 'down' | 'bottom' }
 *
 * Reordena uma parada dentro da rota ajustando o campo `sequence`.
 *   - up/down: troca com a parada adjacente (considera apenas paradas nao
 *     finalizadas, pra nao "voltar atras" em algo ja concluido)
 *   - bottom: move pro fim da lista (util pra "adiar" no motorista)
 *
 * COMPLETED/FAILED ficam ancoradas — motorista nao pode reordenar historico.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const direction: 'up' | 'down' | 'bottom' = body.direction
    if (!['up', 'down', 'bottom'].includes(direction)) {
      return error('direction deve ser up, down ou bottom', 400)
    }

    const updated = await prisma.$transaction(async (tx) => {
      const stop = await tx.logisticsStop.findFirst({
        where: { id: params.stopId, route_id: params.id, company_id: user.companyId },
      })
      if (!stop) throw new Error('NOT_FOUND')
      if (stop.status === 'COMPLETED' || stop.status === 'FAILED') {
        throw new Error('FINALIZED')
      }

      if (direction === 'bottom') {
        // Move pro fim: nova sequence = max + 1
        const maxRow = await tx.logisticsStop.findFirst({
          where: { route_id: params.id, company_id: user.companyId },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        })
        const newSeq = (maxRow?.sequence ?? 0) + 1
        if (newSeq === stop.sequence) return stop
        return tx.logisticsStop.update({
          where: { id: stop.id },
          data: { sequence: newSeq },
        })
      }

      // up/down: achar vizinho nao-finalizado mais proximo na direcao desejada
      const neighbor = direction === 'up'
        ? await tx.logisticsStop.findFirst({
            where: {
              route_id: params.id, company_id: user.companyId,
              sequence: { lt: stop.sequence },
              status: { notIn: ['COMPLETED', 'FAILED'] },
            },
            orderBy: { sequence: 'desc' },
          })
        : await tx.logisticsStop.findFirst({
            where: {
              route_id: params.id, company_id: user.companyId,
              sequence: { gt: stop.sequence },
              status: { notIn: ['COMPLETED', 'FAILED'] },
            },
            orderBy: { sequence: 'asc' },
          })
      if (!neighbor) return stop

      // Swap via sequence temporaria pra evitar conflito de unique (se houver)
      const tempSeq = -Math.abs(stop.sequence) - 10_000
      await tx.logisticsStop.update({ where: { id: stop.id }, data: { sequence: tempSeq } })
      await tx.logisticsStop.update({ where: { id: neighbor.id }, data: { sequence: stop.sequence } })
      return tx.logisticsStop.update({ where: { id: stop.id }, data: { sequence: neighbor.sequence } })
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: `reorder_stop_${direction}`,
      entityId: params.stopId,
      newValue: { direction, new_sequence: updated.sequence },
    })

    return success({ id: updated.id, sequence: updated.sequence })
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND') return error('Parada nao encontrada', 404)
    if (err?.message === 'FINALIZED') return error('Nao e possivel reordenar parada ja finalizada', 400)
    return handleError(err)
  }
}
