import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * DEBUG TEMPORÁRIO 2026-06-01 (Karlão NPE NFe persistente):
 * Lista últimos 5 fiscal_logs com erro NFe pra investigação cliente-side.
 * REMOVER após resolver o bug.
 *
 * GET /api/admin/debug-nfe
 */
export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const logs = await prisma.fiscalLog.findMany({
      where: {
        company_id: user.companyId,
        action: { in: ['nfe_recebidas_sync_error', 'nfe_erro', 'nfe_emitir', 'nfe_resposta'] },
      },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: { id: true, action: true, request: true, response: true, status_code: true, created_at: true },
    })

    return success({ logs, count: logs.length })
  } catch (err) {
    return handleError(err)
  }
}
