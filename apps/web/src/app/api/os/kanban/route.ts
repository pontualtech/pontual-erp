import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const technicianId = url.get('assignedTo') || url.get('technicianId') || undefined
    const osType = url.get('osType') || undefined

    // Get all active statuses for OS module, ordered by order
    const statuses = await prisma.moduleStatus.findMany({
      where: { company_id: user.companyId, module: 'os' },
      orderBy: { order: 'asc' },
    })

    // Get OS grouped by status
    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
    }
    if (technicianId) where.technician_id = technicianId
    if (osType) where.os_type = osType

    // Excluir finalizadas do kanban (Entregue, Cancelada)
    const finalStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: user.companyId, module: 'os', is_final: true },
      select: { id: true },
    })
    if (finalStatuses.length > 0) {
      where.status_id = { notIn: finalStatuses.map(s => s.id) }
    }

    const orders = await prisma.serviceOrder.findMany({
      where,
      take: 500,
      orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
      include: {
        customers: { select: { id: true, legal_name: true, phone: true } },
      },
    })

    // Group by status_id
    const columns = statuses.map(status => ({
      id: status.id,
      name: status.name,
      color: status.color,
      order: status.order,
      items: orders.filter(o => o.status_id === status.id),
    }))

    return success(columns)
  } catch (err) {
    return handleError(err)
  }
}
