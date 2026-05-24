import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * Wave S (audit 2026-05-24): POST /api/financeiro/contas-pagar/bulk-reconcile
 * Mesmo padrão de contas-receber/bulk-reconcile (ver doc lá).
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const { ids, reconciled } = body as { ids?: string[]; reconciled?: boolean }

    if (!Array.isArray(ids) || ids.length === 0) {
      return error('ids é obrigatório (array não vazio)', 400)
    }
    if (typeof reconciled !== 'boolean') {
      return error('reconciled é obrigatório (boolean true/false)', 400)
    }
    if (ids.length > 200) {
      return error('Máximo 200 itens por operação', 400)
    }

    const result_upd = await prisma.accountPayable.updateMany({
      where: { id: { in: ids }, company_id: user.companyId, deleted_at: null },
      data: { reconciled, updated_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: reconciled ? 'bulk_reconcile_ap' : 'bulk_unreconcile_ap',
      entityId: ids.slice(0, 10).join(','),
      newValue: { count: result_upd.count, reconciled, ids_total: ids.length },
    })

    return success({
      updated: result_upd.count,
      requested: ids.length,
      reconciled,
    })
  } catch (err) {
    return handleError(err)
  }
}
