import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const { ids, technician_id } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) return error('ids é obrigatório', 400)
    if (!technician_id) return error('technician_id é obrigatório', 400)
    if (ids.length > 100) return error('Máximo 100 OS por vez', 400)

    // Validate technician exists in this company
    const tech = await prisma.userProfile.findFirst({
      where: { id: technician_id, company_id: user.companyId },
      select: { id: true, name: true },
    })
    if (!tech) return error('Técnico não encontrado', 404)

    const updated = await prisma.serviceOrder.updateMany({
      where: {
        id: { in: ids },
        company_id: user.companyId,
        deleted_at: null,
      },
      data: { technician_id },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'bulk_assign',
      entityId: ids.join(','),
      newValue: { technician_id, technician_name: tech.name, count: updated.count },
    })

    return success({ updated: updated.count, technician: tech.name })
  } catch (err) {
    return handleError(err)
  }
}
