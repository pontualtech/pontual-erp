import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser, hasPermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET() {
  try {
    const user = await getServerUser()
    if (!user) return error('Nao autenticado', 401)

    const cid = user.companyId

    // ---- Status IDs lookup ----
    const allStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: cid, module: 'os' },
      select: { id: true, name: true, color: true, is_final: true, order: true },
      orderBy: { order: 'asc' },
    })
    const finalIds = allStatuses.filter(s => s.is_final).map(s => s.id)

    // Find the "Em Execução" status id (match status name containing "Execu", case-insensitive)
    const execStatusIds = allStatuses
      .filter(s => /execu[çc]/i.test(s.name))
      .map(s => s.id)

    // ---- Date boundaries (use UTC to avoid timezone mismatches with DB) ----
    const now = new Date()
    // Use Sao Paulo offset (UTC-3) to determine "today" in local time
    const spNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const todayStart = new Date(Date.UTC(spNow.getFullYear(), spNow.getMonth(), spNow.getDate()))
    const todayEnd = new Date(todayStart.getTime() + 86400000)
    const monthStart = new Date(Date.UTC(spNow.getFullYear(), spNow.getMonth(), 1))

    // ---- 1. Summary Cards ----
    const [
      osAbertasHoje,
      osEmExecucao,
      osProntas,
      faturamentoMesCents,
    ] = await Promise.all([
      // OS abertas hoje (excluindo finalizadas)
      prisma.serviceOrder.count({
        where: {
          company_id: cid,
          deleted_at: null,
          created_at: { gte: todayStart, lt: todayEnd },
          ...(finalIds.length > 0 ? { status_id: { notIn: finalIds } } : {}),
        },
      }),

      // D-01 FIX: OS em execução — only those with status name matching "Execu*"
      execStatusIds.length > 0
        ? prisma.serviceOrder.count({
            where: { company_id: cid, deleted_at: null, status_id: { in: execStatusIds } },
          })
        : Promise.resolve(0),

      // OS prontas para entrega (status final)
      prisma.serviceOrder.count({
        where: {
          company_id: cid,
          deleted_at: null,
          status_id: { in: finalIds },
          actual_delivery: null,
        },
      }),

      // D-04 FIX: Faturamento do mes — same logic as BI Comissão:
      // sum total_cost from OS with is_final=true status, updated this month
      prisma.serviceOrder.aggregate({
        where: {
          company_id: cid,
          deleted_at: null,
          ...(finalIds.length > 0 ? { status_id: { in: finalIds } } : {}),
          updated_at: { gte: monthStart },
        },
        _sum: { total_cost: true },
      }),
    ])

    // ---- 2. OS por Semana (ultimas 8 semanas) ----
    // Include current week + 8 full weeks back (63 days to be safe with timezone)
    const eightWeeksAgo = new Date()
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 63)

    const osPerWeek: { week: string; count: string }[] = await prisma.$queryRawUnsafe(`
      SELECT
        to_char(date_trunc('week', created_at), 'DD/MM') as week,
        COUNT(*)::text as count
      FROM service_orders
      WHERE company_id = $1
        AND deleted_at IS NULL
        AND created_at >= $2
      GROUP BY date_trunc('week', created_at)
      ORDER BY date_trunc('week', created_at)
    `, cid, eightWeeksAgo)

    // ---- 3. Pipeline de OS (count by status) ----
    // D-03 FIX: Include ALL statuses (even with 0 count), only count non-deleted OS
    const pipeline = await prisma.serviceOrder.groupBy({
      by: ['status_id'],
      where: { company_id: cid, deleted_at: null },
      _count: { id: true },
    })

    const pipelineCounts = new Map(pipeline.map(p => [p.status_id, p._count.id]))

    const pipelineData = allStatuses.map(status => ({
      name: status.name,
      color: status.color ?? '#6B7280',
      count: pipelineCounts.get(status.id) ?? 0,
    })).sort((a, b) => {
      const orderA = allStatuses.find(s => s.name === a.name)?.order ?? 99
      const orderB = allStatuses.find(s => s.name === b.name)?.order ?? 99
      return (orderA ?? 0) - (orderB ?? 0)
    })

    // ---- 4. Metricas ----
    // Tempo medio de reparo (dias entre abertura e entrega)
    const avgRepair: { avg_days: number | null }[] = await prisma.$queryRawUnsafe(`
      SELECT
        AVG(ABS(EXTRACT(EPOCH FROM (actual_delivery - created_at)) / 86400))::numeric(10,1) as avg_days
      FROM service_orders
      WHERE company_id = $1
        AND deleted_at IS NULL
        AND actual_delivery IS NOT NULL
        AND created_at >= $2
    `, cid, monthStart)

    // D-06 FIX: Taxa de aprovação based on status transitions in service_order_history
    // Denominator: OS that passed through any status containing "orç" or "aguardando aprovação"
    // Numerator: OS that passed through any status containing "aprovad"
    const approvalStatuses = allStatuses.filter(s => /aprovad/i.test(s.name)).map(s => s.id)
    const quoteStatuses = allStatuses.filter(s => /or[çc]|aguardando\s*aprova/i.test(s.name)).map(s => s.id)

    let quotesTotal = 0
    let quotesApproved = 0

    if (quoteStatuses.length > 0) {
      // OS that went through a quote/budget status
      const quotedOs: { cnt: string }[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(DISTINCT service_order_id)::text AS cnt
        FROM service_order_history
        WHERE company_id = $1
          AND to_status_id = ANY($2::text[])
      `, cid, quoteStatuses)
      quotesTotal = Number(quotedOs[0]?.cnt ?? 0)
    }

    if (approvalStatuses.length > 0) {
      // OS that went through an approved status
      const approvedOs: { cnt: string }[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(DISTINCT service_order_id)::text AS cnt
        FROM service_order_history
        WHERE company_id = $1
          AND to_status_id = ANY($2::text[])
      `, cid, approvalStatuses)
      quotesApproved = Number(approvedOs[0]?.cnt ?? 0)
    }

    // Ticket medio (valor medio das OS entregues no mes)
    const avgTicket: { avg_ticket: number | null }[] = await prisma.$queryRawUnsafe(`
      SELECT
        AVG(total_cost)::numeric(10,0) as avg_ticket
      FROM service_orders
      WHERE company_id = $1
        AND deleted_at IS NULL
        AND actual_delivery IS NOT NULL
        AND actual_delivery >= $2
        AND total_cost > 0
    `, cid, monthStart)

    // ---- 5. Recent Activity ----
    const [recentOs, recentReceivable] = await Promise.all([
      prisma.serviceOrder.findMany({
        where: { company_id: cid, deleted_at: null },
        orderBy: { created_at: 'desc' },
        take: 5,
        include: {
          customers: { select: { legal_name: true } },
          module_statuses: { select: { name: true, color: true } },
        },
      }),
      prisma.accountReceivable.findMany({
        where: { company_id: cid, deleted_at: null },
        orderBy: { created_at: 'desc' },
        take: 5,
        include: {
          customers: { select: { legal_name: true } },
        },
      }),
    ])

    // Check if user has financial permissions
    const canViewFinanceiro = user.roleName === 'admin' || await hasPermission(user.id, user.companyId, 'financeiro', 'view')

    return success({
      cards: {
        osAbertasHoje,
        osEmExecucao,
        osProntas,
        ...(canViewFinanceiro ? { faturamentoMesCents: faturamentoMesCents._sum.total_cost ?? 0 } : {}),
      },
      osPerWeek: osPerWeek.map(w => ({ week: w.week, count: Number(w.count) })),
      pipeline: pipelineData,
      metrics: {
        avgRepairDays: avgRepair[0]?.avg_days ? Number(avgRepair[0].avg_days) : null,
        approvalRate: quotesTotal > 0 ? Math.round((quotesApproved / quotesTotal) * 100) : 0,
        ...(canViewFinanceiro ? { avgTicketCents: avgTicket[0]?.avg_ticket ? Number(avgTicket[0].avg_ticket) : null } : {}),
      },
      recentOs: recentOs.map(o => ({
        id: o.id,
        os_number: o.os_number,
        customer_name: o.customers?.legal_name ?? 'Sem cliente',
        status_name: o.module_statuses?.name ?? '—',
        status_color: o.module_statuses?.color ?? '#6B7280',
        created_at: o.created_at,
      })),
      recentReceivable: !canViewFinanceiro ? [] : recentReceivable.map(r => ({
        id: r.id,
        description: r.description,
        customer_name: r.customers?.legal_name ?? '—',
        total_amount: r.total_amount,
        status: r.status,
        due_date: r.due_date,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
