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

    const { toStatusId, notes } = await req.json()
    if (!toStatusId) return error('toStatusId é obrigatório', 400)

    // Load current OS
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!os) return error('OS não encontrada', 404)

    // Validate target status exists for this company
    const toStatus = await prisma.moduleStatus.findFirst({
      where: { id: toStatusId, company_id: user.companyId, module: 'os' },
    })
    if (!toStatus) return error('Status de destino não encontrado', 404)

    // Validate transition: check allowed transitions from current status
    const currentStatus = await prisma.moduleStatus.findFirst({
      where: { id: os.status_id, company_id: user.companyId, module: 'os' },
    })
    if (!currentStatus) return error('Status atual inválido', 500)

    // transitions is a JSON array of status IDs that can follow this one
    const allowedTransitions: string[] = Array.isArray(currentStatus.transitions)
      ? currentStatus.transitions as string[]
      : []

    if (allowedTransitions.length > 0 && !allowedTransitions.includes(toStatusId)) {
      return error(
        `Transição não permitida: ${currentStatus.name} → ${toStatus.name}`,
        422
      )
    }

    // Execute transition
    const [updated] = await prisma.$transaction([
      prisma.serviceOrder.update({
        where: { id: params.id },
        data: {
          status_id: toStatusId,
          // If target status is final, set actual_delivery
          ...(toStatus.is_final ? { actual_delivery: new Date() } : {}),
        },
        include: { customers: true },
      }),
      prisma.serviceOrderHistory.create({
        data: {
          company_id: user.companyId,
          service_order_id: params.id,
          from_status_id: os.status_id,
          to_status_id: toStatusId,
          changed_by: user.id,
          notes: notes || null,
        },
      }),
    ])

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'transition',
      entityId: params.id,
      oldValue: { statusId: os.status_id },
      newValue: { statusId: toStatusId, notes },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
