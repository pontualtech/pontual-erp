import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const now = new Date()
    const dateFrom = url.get('dateFrom') || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const dateTo = url.get('dateTo') || now.toISOString().split('T')[0]
    const cid = user.companyId

    // Total OS created in period
    const totalCreated: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM service_orders
      WHERE company_id = $1
        AND deleted_at IS NULL
        AND created_at >= $2::timestamptz
        AND created_at <= ($3::date + interval '1 day')::timestamptz
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    // OS that have a quote OR have estimated_cost > 0 (orcado)
    const totalQuoted: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT so.id)::int AS count
      FROM service_orders so
      LEFT JOIN quotes q ON q.service_order_id = so.id
      WHERE so.company_id = $1
        AND so.deleted_at IS NULL
        AND (q.id IS NOT NULL OR COALESCE(so.estimated_cost, 0) > 0)
        AND so.created_at >= $2::timestamptz
        AND so.created_at <= ($3::date + interval '1 day')::timestamptz
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    // OS with approved quote OR approved_cost > 0
    const totalApproved: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT so.id)::int AS count
      FROM service_orders so
      LEFT JOIN quotes q ON q.service_order_id = so.id AND q.status = 'APPROVED'
      WHERE so.company_id = $1
        AND so.deleted_at IS NULL
        AND (q.id IS NOT NULL OR COALESCE(so.approved_cost, 0) > 0)
        AND so.created_at >= $2::timestamptz
        AND so.created_at <= ($3::date + interval '1 day')::timestamptz
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    // Completed (final status)
    const finalStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: cid, module: 'os', is_final: true },
      select: { id: true },
    })
    const finalIds = finalStatuses.map(s => `'${s.id}'`).join(',')

    let totalCompleted = 0
    if (finalIds) {
      const completedResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS count
        FROM service_orders
        WHERE company_id = $1
          AND deleted_at IS NULL
          AND status_id IN (${finalIds})
          AND created_at >= $2::timestamptz
          AND created_at <= ($3::date + interval '1 day')::timestamptz
      `, cid, `${dateFrom}T00:00:00Z`, dateTo)
      totalCompleted = Number(completedResult[0]?.count || 0)
    }

    // Paid (has accounts_receivable with status PAGO/RECEBIDO/LIQUIDADO or received_amount > 0)
    const totalPaid: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT so.id)::int AS count
      FROM service_orders so
      JOIN accounts_receivable ar ON ar.service_order_id = so.id
      WHERE so.company_id = $1
        AND so.deleted_at IS NULL
        AND ar.deleted_at IS NULL
        AND (ar.status IN ('PAGO', 'RECEBIDO', 'LIQUIDADO') OR COALESCE(ar.received_amount, 0) > 0)
        AND so.created_at >= $2::timestamptz
        AND so.created_at <= ($3::date + interval '1 day')::timestamptz
    `, cid, `${dateFrom}T00:00:00Z`, dateTo)

    const created = Number(totalCreated[0]?.count || 0)
    // Enforce monotonically decreasing: each step <= previous step
    const rawQuoted = Number(totalQuoted[0]?.count || 0)
    const rawApproved = Number(totalApproved[0]?.count || 0)
    const rawCompleted = totalCompleted
    const rawPaid = Number(totalPaid[0]?.count || 0)

    const quoted = Math.min(rawQuoted, created)
    const approved = Math.min(rawApproved, quoted)
    const completed = Math.min(rawCompleted, approved)
    const paid = Math.min(rawPaid, completed)

    const steps = [
      { name: 'Criadas', count: created, percent: 100 },
      { name: 'Orcadas', count: quoted, percent: created > 0 ? Math.round((quoted / created) * 10000) / 100 : 0 },
      { name: 'Aprovadas', count: approved, percent: created > 0 ? Math.round((approved / created) * 10000) / 100 : 0 },
      { name: 'Concluidas', count: completed, percent: created > 0 ? Math.round((completed / created) * 10000) / 100 : 0 },
      { name: 'Pagas', count: paid, percent: created > 0 ? Math.round((paid / created) * 10000) / 100 : 0 },
    ]

    // Conversion rates between steps (capped at 100%)
    const conversions = [
      { from: 'Criadas', to: 'Orcadas', rate: created > 0 ? Math.min(100, Math.round((quoted / created) * 10000) / 100) : 0 },
      { from: 'Orcadas', to: 'Aprovadas', rate: quoted > 0 ? Math.min(100, Math.round((approved / quoted) * 10000) / 100) : 0 },
      { from: 'Aprovadas', to: 'Concluidas', rate: approved > 0 ? Math.min(100, Math.round((completed / approved) * 10000) / 100) : 0 },
      { from: 'Concluidas', to: 'Pagas', rate: completed > 0 ? Math.min(100, Math.round((paid / completed) * 10000) / 100) : 0 },
    ]

    return success({ steps, conversions })
  } catch (err) {
    return handleError(err)
  }
}
