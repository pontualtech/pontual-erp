import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/financeiro/cobrancas/summary
 *
 * Retorna agregados de cobrancas Asaas (charge_status) pra widget de
 * dashboard. Conta + soma por grupo:
 *  - vencidas    : charge_status = 'OVERDUE'
 *  - aguardando  : charge_status = 'PENDING' (e AR ainda nao recebido)
 *  - pagas_hoje  : charge_status IN (RECEIVED, CONFIRMED) E AR.updated_at = hoje
 *  - enviadas_hoje: charge_sent_at >= hoje (count)
 *
 * Feature 2026-05-14 (feat 3/4) — widget dashboard.
 */
export async function GET(_req: NextRequest) {
  try {
    const auth = await requirePermission('financeiro', 'view')
    if (auth instanceof NextResponse) return auth

    const now = new Date()
    // Audit fix 2026-05-14 #2: UTC explicito (consistencia AR.due_date que
    // eh armazenado em UTC). TZ local do server podia causar drift de 3h.
    const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z')
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

    type Row = {
      vencidas_sum: bigint | number; vencidas_count: bigint
      aguardando_sum: bigint | number; aguardando_count: bigint
      pagas_hoje_sum: bigint | number; pagas_hoje_count: bigint
      enviadas_hoje_count: bigint
    }
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        COALESCE(SUM(CASE WHEN charge_status = 'OVERDUE' THEN total_amount ELSE 0 END), 0) as vencidas_sum,
        COUNT(CASE WHEN charge_status = 'OVERDUE' THEN 1 END) as vencidas_count,
        COALESCE(SUM(CASE WHEN charge_status = 'PENDING' THEN total_amount ELSE 0 END), 0) as aguardando_sum,
        COUNT(CASE WHEN charge_status = 'PENDING' THEN 1 END) as aguardando_count,
        COALESCE(SUM(CASE WHEN charge_status IN ('RECEIVED','CONFIRMED') AND updated_at >= ${today} AND updated_at < ${tomorrow} THEN total_amount ELSE 0 END), 0) as pagas_hoje_sum,
        COUNT(CASE WHEN charge_status IN ('RECEIVED','CONFIRMED') AND updated_at >= ${today} AND updated_at < ${tomorrow} THEN 1 END) as pagas_hoje_count,
        COUNT(CASE WHEN charge_sent_at >= ${today} AND charge_sent_at < ${tomorrow} THEN 1 END) as enviadas_hoje_count
      FROM accounts_receivable
      WHERE company_id = ${auth.companyId} AND deleted_at IS NULL
    `

    const r: Partial<Row> = rows[0] ?? {}
    return success({
      vencidas: { sum: Number(r.vencidas_sum) || 0, count: Number(r.vencidas_count) || 0 },
      aguardando: { sum: Number(r.aguardando_sum) || 0, count: Number(r.aguardando_count) || 0 },
      pagas_hoje: { sum: Number(r.pagas_hoje_sum) || 0, count: Number(r.pagas_hoje_count) || 0 },
      enviadas_hoje: { count: Number(r.enviadas_hoje_count) || 0 },
    })
  } catch (err) {
    return handleError(err)
  }
}
