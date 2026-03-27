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

    const { toStatusId, notes, payment_method } = await req.json()
    if (!toStatusId) return error('toStatusId é obrigatório', 400)

    // Load current OS with customer
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: { customers: true },
    })
    if (!os) return error('OS não encontrada', 404)

    // Validate target status
    const toStatus = await prisma.moduleStatus.findFirst({
      where: { id: toStatusId, company_id: user.companyId, module: 'os' },
    })
    if (!toStatus) return error('Status de destino não encontrado', 404)

    // Validate current status
    const currentStatus = await prisma.moduleStatus.findFirst({
      where: { id: os.status_id, company_id: user.companyId, module: 'os' },
    })
    if (!currentStatus) return error('Status atual inválido', 500)

    // Check allowed transitions
    const allowedTransitions: string[] = Array.isArray(currentStatus.transitions)
      ? currentStatus.transitions as string[]
      : []
    if (allowedTransitions.length > 0 && !allowedTransitions.includes(toStatusId)) {
      return error(`Transição não permitida: ${currentStatus.name} → ${toStatus.name}`, 422)
    }

    // If target is a final status (Entregue) and OS has a total, require payment_method
    const isFinalDelivery = toStatus.is_final && toStatus.name !== 'Cancelada' && (os.total_cost ?? 0) > 0
    if (isFinalDelivery && !payment_method) {
      return error('Forma de pagamento é obrigatória para finalizar a OS', 400)
    }

    // Execute transition
    const [updated] = await prisma.$transaction([
      prisma.serviceOrder.update({
        where: { id: params.id },
        data: {
          status_id: toStatusId,
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

    // Auto-create AccountReceivable when delivering (final status, not cancelled)
    if (isFinalDelivery) {
      // Find "Venda de Servicos" category or first receita category
      const category = await prisma.category.findFirst({
        where: {
          company_id: user.companyId,
          module: 'financeiro_receita',
        },
        orderBy: { name: 'asc' },
      })

      await prisma.accountReceivable.create({
        data: {
          company_id: user.companyId,
          customer_id: os.customer_id,
          service_order_id: os.id,
          category_id: category?.id || null,
          description: `OS-${String(os.os_number).padStart(4, '0')} — ${os.equipment_type || 'Serviço'} ${os.equipment_brand || ''} ${os.equipment_model || ''}`.trim(),
          total_amount: os.total_cost ?? 0,
          received_amount: 0,
          due_date: new Date(),
          status: 'PENDENTE',
          payment_method: payment_method,
          notes: `Gerado automaticamente ao entregar OS-${String(os.os_number).padStart(4, '0')}`,
        },
      })

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'financeiro',
        action: 'auto_receivable',
        entityId: params.id,
        newValue: {
          os_number: os.os_number,
          total_cost: os.total_cost,
          payment_method,
          customer: os.customers?.legal_name,
        },
      })
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'transition',
      entityId: params.id,
      oldValue: { statusId: os.status_id },
      newValue: { statusId: toStatusId, notes, payment_method },
    })

    return success({ ...updated, receivable_created: isFinalDelivery })
  } catch (err) {
    return handleError(err)
  }
}
