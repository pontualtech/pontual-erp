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
    })
    if (!route) return error('Rota não encontrada', 404)

    if (route.status === 'IN_PROGRESS') return error('Rota já está em andamento', 422)
    if (route.status === 'COMPLETED') return error('Rota já foi concluída', 422)

    const updated = await prisma.logisticsRoute.update({
      where: { id: params.id },
      data: {
        status: 'IN_PROGRESS',
        started_at: new Date(),
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
      action: 'start_route',
      entityId: params.id,
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
