import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string; stopId: string } }

/**
 * POST /api/logistics/routes/[id]/stops/[stopId]/adiar
 * body: { reason: string, reschedule_at?: string (ISO) }
 *
 * Marca a parada como adiada e empurra pro fim da fila da rota, sem
 * alterar o status (continua PENDING). O motorista pode chamar de novo
 * na mesma rota se o cliente aparecer, ou pode ser reagendada pra outra
 * data via reschedule_at.
 *
 * Diferenca vs falha (FAILED):
 *   - FAILED encerra a tentativa, parada sai do fluxo ativo
 *   - ADIAR mantem PENDING mas desce no ordering
 *
 * Usado tanto pelo app motorista (cliente ausente na hora) quanto
 * pelo escritorio (remarcando proativamente).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return error('Informe o motivo', 400)
    const rescheduleAt = body.reschedule_at ? new Date(body.reschedule_at) : new Date()

    const updated = await prisma.$transaction(async (tx) => {
      const stop = await tx.logisticsStop.findFirst({
        where: { id: params.stopId, route_id: params.id, company_id: user.companyId },
      })
      if (!stop) throw new Error('NOT_FOUND')
      if (stop.status === 'COMPLETED' || stop.status === 'FAILED') {
        throw new Error('FINALIZED')
      }

      // Move pro fim da fila
      const maxRow = await tx.logisticsStop.findFirst({
        where: { route_id: params.id, company_id: user.companyId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      })
      const newSeq = Math.max((maxRow?.sequence ?? 0) + 1, stop.sequence)

      return tx.logisticsStop.update({
        where: { id: stop.id },
        data: {
          sequence: newSeq,
          visit_reschedule_at: rescheduleAt,
          visit_reschedule_note: reason.slice(0, 500),
        },
      })
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'postpone_stop',
      entityId: params.stopId,
      newValue: { reason, reschedule_at: rescheduleAt.toISOString(), new_sequence: updated.sequence },
    })

    return success({
      id: updated.id,
      sequence: updated.sequence,
      visit_reschedule_at: updated.visit_reschedule_at,
      visit_reschedule_note: updated.visit_reschedule_note,
    })
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND') return error('Parada nao encontrada', 404)
    if (err?.message === 'FINALIZED') return error('Parada ja finalizada nao pode ser adiada', 400)
    return handleError(err)
  }
}
