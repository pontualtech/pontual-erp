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
    })
    if (!stop) return error('Parada não encontrada', 404)

    if (stop.status === 'ARRIVED') return error('Motorista já chegou nesta parada', 422)
    if (stop.status === 'COMPLETED') return error('Parada já foi concluída', 422)
    if (stop.status === 'FAILED') return error('Parada marcada como falha', 422)

    const updated = await prisma.logisticsStop.update({
      where: { id: params.id },
      data: {
        status: 'ARRIVED',
        arrived_at: new Date(),
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'arrive_stop',
      entityId: params.id,
      newValue: { route_id: stop.route_id, sequence: stop.sequence },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
