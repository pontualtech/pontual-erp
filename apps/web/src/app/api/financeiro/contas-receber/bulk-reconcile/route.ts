import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * Wave S (audit 2026-05-24): POST /api/financeiro/contas-receber/bulk-reconcile
 *
 * Karlão pediu: filtro + bulk reconcile pra não abrir uma a uma. Operador
 * marca várias contas como conciliadas (após conferir extrato bancário) de
 * uma vez só.
 *
 * Body: { ids: string[], reconciled: boolean }
 * - reconciled=true → marca como conferido (após bater com extrato)
 * - reconciled=false → desfaz (rebaixa pra "aguardando")
 *
 * Não cria Transaction nem altera saldo — apenas flip do flag reconciled.
 * Tenant scoped via updateMany c/ company_id no where.
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

    // Tenant-scoped updateMany — só atualiza AR da mesma empresa do user
    const result_upd = await prisma.accountReceivable.updateMany({
      where: { id: { in: ids }, company_id: user.companyId, deleted_at: null },
      data: { reconciled, updated_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: reconciled ? 'bulk_reconcile' : 'bulk_unreconcile',
      entityId: ids.slice(0, 10).join(','), // primeiros 10 IDs no log
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
