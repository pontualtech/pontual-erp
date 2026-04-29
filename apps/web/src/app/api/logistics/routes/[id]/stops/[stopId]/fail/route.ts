import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string; stopId: string } }

/**
 * POST /api/logistics/routes/[id]/stops/[stopId]/fail
 * body: { reason: string }
 *
 * Marca uma parada como FAILED (cliente desistiu, recusou, problema
 * de logistica). Acionado pelo atendente do ERP quando o cliente
 * informa por outro canal que nao quer mais a coleta/entrega.
 *
 * Efeito imediato: motorista app (que polla /api/driver/rota/hoje
 * a cada refresh) ve a parada marcada como FAILED e nao tenta mais
 * ir. Status final, nao reverte sem intervencao manual.
 *
 * Diferenca vs /adiar:
 *   - /adiar: parada continua PENDING, motorista tenta de novo no fim
 *   - /fail: parada encerra. Cliente nao quer mais. OS volta pro
 *     escritorio resolver (cancelar, refazer, etc).
 *
 * Permissao: os.edit (atendente, admin).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return error('Informe o motivo da falha', 400)

    const stop = await prisma.logisticsStop.findFirst({
      where: { id: params.stopId, route_id: params.id, company_id: user.companyId },
    })
    if (!stop) return error('Parada nao encontrada', 404)
    if (stop.status === 'COMPLETED') return error('Parada ja foi concluida — nao pode marcar falha', 400)
    if (stop.status === 'FAILED') return error('Parada ja esta marcada como falha', 400)

    const updated = await prisma.logisticsStop.update({
      where: { id: stop.id },
      data: {
        status: 'FAILED',
        failure_reason: reason.slice(0, 500),
        completed_at: new Date(),  // marca tempo do encerramento (mesmo que falha)
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'fail_stop',
      entityId: params.stopId,
      newValue: { reason, route_id: params.id, customer_name: stop.customer_name } as any,
    })

    return success({
      id: updated.id,
      status: updated.status,
      failure_reason: updated.failure_reason,
    })
  } catch (err) {
    return handleError(err)
  }
}
