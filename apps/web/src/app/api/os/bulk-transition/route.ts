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

    const { ids, toStatusId } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) return error('ids é obrigatório', 400)
    if (!toStatusId) return error('toStatusId é obrigatório', 400)
    if (ids.length > 100) return error('Máximo 100 OS por vez', 400)

    // Validate target status — must not be final (bulk doesn't handle payment)
    const toStatus = await prisma.moduleStatus.findFirst({
      where: { id: toStatusId, company_id: user.companyId, module: 'os' },
    })
    if (!toStatus) return error('Status de destino não encontrado', 404)
    if (toStatus.is_final) return error('Não é possível alterar em massa para status final (requer pagamento). Use a transição individual.', 422)

    const results: { id: string; os_number: number; success: boolean; error?: string }[] = []

    for (const osId of ids) {
      try {
        const os = await prisma.serviceOrder.findFirst({
          where: { id: osId, company_id: user.companyId, deleted_at: null },
        })
        if (!os) {
          results.push({ id: osId, os_number: 0, success: false, error: 'OS não encontrada' })
          continue
        }

        // Check current status
        const currentStatus = await prisma.moduleStatus.findFirst({
          where: { id: os.status_id, company_id: user.companyId, module: 'os' },
        })

        // Check allowed transitions
        const allowedTransitions: string[] = Array.isArray(currentStatus?.transitions)
          ? currentStatus!.transitions as string[]
          : []
        if (allowedTransitions.length > 0 && !allowedTransitions.includes(toStatusId)) {
          results.push({ id: osId, os_number: os.os_number, success: false, error: `Transição não permitida: ${currentStatus?.name} → ${toStatus.name}` })
          continue
        }

        // Block reversal from final status
        if (currentStatus?.is_final && !toStatus.is_final) {
          results.push({ id: osId, os_number: os.os_number, success: false, error: `OS finalizada (${currentStatus.name})` })
          continue
        }

        // Build update data
        const updateData: any = { status_id: toStatusId }

        // Se Aprovado, calcular previsão de 10 dias úteis
        const toNameLower = toStatus.name.toLowerCase()
        if (toNameLower.includes('aprovado')) {
          let diasUteis = 0
          const data = new Date()
          while (diasUteis < 10) {
            data.setDate(data.getDate() + 1)
            const dow = data.getDay()
            if (dow !== 0 && dow !== 6) diasUteis++
          }
          updateData.estimated_delivery = data
        }

        await prisma.$transaction(async (tx) => {
          await tx.serviceOrder.update({
            where: { id: osId },
            data: updateData,
          })
          await tx.serviceOrderHistory.create({
            data: {
              company_id: user.companyId,
              service_order_id: osId,
              from_status_id: os.status_id,
              to_status_id: toStatusId,
              changed_by: user.id,
              notes: 'Alteração em massa',
            },
          })
        })

        results.push({ id: osId, os_number: os.os_number, success: true })

        logAudit({
          companyId: user.companyId,
          userId: user.id,
          module: 'os',
          action: 'bulk_transition',
          entityId: osId,
          oldValue: { statusId: os.status_id },
          newValue: { statusId: toStatusId },
        })
      } catch (err: any) {
        results.push({ id: osId, os_number: 0, success: false, error: err.message || 'Erro desconhecido' })
      }
    }

    const ok = results.filter(r => r.success).length
    const fail = results.filter(r => !r.success).length

    return success({ results, ok, fail })
  } catch (err) {
    return handleError(err)
  }
}
