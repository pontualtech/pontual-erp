import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

/**
 * POST /api/os/[id]/garantia — Reabrir OS em garantia
 *
 * Cria uma nova OS filha vinculada à original com:
 * - is_warranty = true
 * - warranty_os_id = ID da OS original
 * - Mesmo cliente, equipamento, técnico
 * - Custo zero (garantia)
 * - Status: Aberta
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    // Buscar OS original
    const original = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: { module_statuses: true },
    })
    if (!original) return error('OS não encontrada', 404)

    // Verificar se está entregue (final)
    if (!original.module_statuses?.is_final) {
      return error('Só é possível abrir garantia de uma OS já finalizada', 400)
    }

    // Verificar período de garantia: máximo 3 meses após entrega
    const deliveryDate = original.actual_delivery || original.updated_at || original.created_at
    const warrantyDeadline = original.warranty_until
      ? new Date(original.warranty_until)
      : deliveryDate
        ? new Date(new Date(deliveryDate).getTime() + 90 * 24 * 60 * 60 * 1000) // 90 dias = ~3 meses
        : null

    if (warrantyDeadline && warrantyDeadline < new Date()) {
      return error(`Periodo de garantia encerrado em ${warrantyDeadline.toLocaleDateString('pt-BR')}. Garantia valida por 3 meses apos a entrega.`, 400)
    }

    const body = await req.json().catch(() => ({}))
    const reportedIssue = body.reported_issue || `Retorno em garantia - OS original #${original.os_number}`

    // Buscar status "Aprovado" (garantia vai direto para execução) ou fallback "Aberta"
    const abertaStatus = await prisma.moduleStatus.findFirst({
      where: { company_id: user.companyId, module: 'os', name: { contains: 'provad', mode: 'insensitive' } },
    }) || await prisma.moduleStatus.findFirst({
      where: { company_id: user.companyId, module: 'os', is_default: true },
    })
    if (!abertaStatus) return error('Status inicial não encontrado', 500)

    // Gerar próximo número de OS
    const lastOS = await prisma.serviceOrder.findFirst({
      where: { company_id: user.companyId },
      orderBy: { os_number: 'desc' },
      select: { os_number: true },
    })
    const nextNumber = (lastOS?.os_number ?? 0) + 1

    // Criar nova OS de garantia
    const warrantyOS = await prisma.serviceOrder.create({
      data: {
        company_id: user.companyId,
        os_number: nextNumber,
        customer_id: original.customer_id,
        technician_id: original.technician_id,
        status_id: abertaStatus.id,
        priority: 'URGENT',
        os_type: original.os_type,
        equipment_type: original.equipment_type,
        equipment_brand: original.equipment_brand,
        equipment_model: original.equipment_model,
        serial_number: original.serial_number,
        reported_issue: reportedIssue,
        diagnosis: null,
        reception_notes: `Garantia da OS-${String(original.os_number).padStart(4, '0')}`,
        internal_notes: null,
        estimated_cost: 0,
        approved_cost: 0,
        total_parts: 0,
        total_services: 0,
        total_cost: 0,
        is_warranty: true,
        warranty_os_id: original.id,
      },
    })

    // Registrar histórico na OS original e na nova
    await Promise.all([
      prisma.serviceOrderHistory.create({
        data: {
          company_id: user.companyId,
          service_order_id: original.id,
          from_status_id: original.status_id,
          to_status_id: original.status_id,
          changed_by: user.id,
          notes: `Garantia aberta → nova OS-${String(nextNumber).padStart(4, '0')}`,
        },
      }),
      prisma.serviceOrderHistory.create({
        data: {
          company_id: user.companyId,
          service_order_id: warrantyOS.id,
          to_status_id: abertaStatus.id,
          changed_by: user.id,
          notes: `OS de garantia criada — original OS-${String(original.os_number).padStart(4, '0')} | ${original.equipment_type || ''} ${original.equipment_brand || ''} ${original.equipment_model || ''}`.trim(),
        },
      }),
    ])

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'warranty.create',
      entityId: warrantyOS.id,
      newValue: {
        os_number: nextNumber,
        original_os: original.os_number,
        customer: original.customer_id,
      },
    })

    return success({
      id: warrantyOS.id,
      os_number: nextNumber,
      original_os_number: original.os_number,
    }, 201)
  } catch (err) {
    return handleError(err)
  }
}
