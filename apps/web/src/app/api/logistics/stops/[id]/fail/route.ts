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

    const stop = await prisma.logisticsStop.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { route: true },
    })
    if (!stop) return error('Parada não encontrada', 404)

    if (stop.status === 'COMPLETED') return error('Parada já foi concluída', 422)
    if (stop.status === 'FAILED') return error('Parada já marcada como falha', 422)

    const body = await req.json()
    const { failure_reason } = body

    if (!failure_reason) return error('Motivo da falha é obrigatório', 400)

    const updated = await prisma.$transaction(async (tx) => {
      const updatedStop = await tx.logisticsStop.update({
        where: { id: params.id, company_id: user.companyId },
        data: {
          status: 'FAILED',
          failure_reason,
        },
      })

      // Create announcement for the team
      await tx.announcement.create({
        data: {
          company_id: user.companyId,
          title: `Falha na ${stop.type === 'COLETA' ? 'coleta' : 'entrega'} — ${stop.customer_name || stop.address}`,
          message: `Parada #${stop.sequence} da rota falhou.\nEndereço: ${stop.address}\nMotivo: ${failure_reason}`,
          priority: 'IMPORTANTE',
          require_read: true,
          author_name: 'Sistema Logística',
          created_by: user.id,
        },
      })

      return updatedStop
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'fail_stop',
      entityId: params.id,
      newValue: { route_id: stop.route_id, failure_reason },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
