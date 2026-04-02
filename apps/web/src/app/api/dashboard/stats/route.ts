import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'
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
      faturamentoMes,
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

      // OS em execucao (nao-finais, excluindo a primeira etapa/default)
      prisma.serviceOrder.count({
        where: { company_id: cid, deleted_at: null, status_id: { notIn: finalIds } },
      }),

      // OS prontas para entrega (status final)
      prisma.serviceOrder.count({
        where: {
          company_id: cid,
          deleted_at: null,
          status_id: { in: finalIds },
          actual_delivery: null,
        },
      }),

      // Faturamento do mes: contas recebidas OR OS com status final
      Promise.all([
        prisma.accountReceivable.aggregate({
          where: {
            company_id: cid,
            deleted_at: null,
            status: { in: ['RECEBIDO', 'PAGO'] },
            updated_at: { gte: monthStart },
          },
          _sum: { received_amount: true },
        }),
        prisma.serviceOrder.aggregate({
          where: {
            company_id: cid,
            deleted_at: null,
            ...(finalIds.length > 0 ? { status_id: { in: finalIds } } : {}),
            created_at: { gte: monthStart },
          },
          _sum: { total_cost: true },
        }),
      ]),
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
    const pipeline = await prisma.serviceOrder.groupBy({
      by: ['status_id'],
      where: { company_id: cid, deleted_at: null },
      _count: { id: true },
    })

    const pipelineData = pipeline.map(p => {
      const status = allStatuses.find(s => s.id === p.status_id)
      return {
        name: status?.name ?? 'Desconhecido',
        color: status?.color ?? '#6B7280',
        count: p._count.id,
      }
    }).sort((a, b) => {
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

    // Taxa de aprovacao de orcamentos
    const [quotesTotal, quotesApproved] = await Promise.all([
      prisma.quote.count({
        where: { company_id: cid, sent_at: { not: null } },
      }),
      prisma.quote.count({
        where: { company_id: cid, approved_at: { not: null } },
      }),
    ])

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

    return success({
      cards: {
        osAbertasHoje,
        osEmExecucao,
        osProntas,
        faturamentoMesCents: (() => {
          const [arAgg, osAgg] = faturamentoMes
          const arTotal = arAgg._sum.received_amount ?? 0
          const osTotal = osAgg._sum.total_cost ?? 0
          // Use accounts receivable if available, otherwise fallback to OS total_cost
          return arTotal > 0 ? arTotal : osTotal
        })(),
      },
      osPerWeek: osPerWeek.map(w => ({ week: w.week, count: Number(w.count) })),
      pipeline: pipelineData,
      metrics: {
        avgRepairDays: avgRepair[0]?.avg_days ? Number(avgRepair[0].avg_days) : null,
        approvalRate: quotesTotal > 0 ? Math.round((quotesApproved / quotesTotal) * 100) : 0,
        avgTicketCents: avgTicket[0]?.avg_ticket ? Number(avgTicket[0].avg_ticket) : null,
      },
      recentOs: recentOs.map(o => ({
        id: o.id,
        os_number: o.os_number,
        customer_name: o.customers?.legal_name ?? 'Sem cliente',
        status_name: o.module_statuses?.name ?? '—',
        status_color: o.module_statuses?.color ?? '#6B7280',
        created_at: o.created_at,
      })),
      recentReceivable: recentReceivable.map(r => ({
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
