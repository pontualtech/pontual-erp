import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const cid = user.companyId

    // Admin pode ver dashboard de qualquer técnico via ?tech_id=
    const url = new URL(req.url)
    const queryTechId = url.searchParams.get('tech_id')
    const isAdmin = user.roleName === 'admin' || user.roleName === 'administrador'
    const techId = (isAdmin && queryTechId) ? queryTechId : user.id
    console.log('[Dashboard Tecnico]', { userId: user.id, roleName: user.roleName, isAdmin, queryTechId, techId, cid })

    const now = new Date()
    const todayStart = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(todayStart)
    todayEnd.setDate(todayEnd.getDate() + 1)

    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)

    // All statuses for classification
    const allStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: cid, module: 'os' },
      select: { id: true, name: true, color: true, order: true, is_final: true },
    })
    const finalIds = allStatuses.filter(s => s.is_final).map(s => s.id)
    const statusMap = Object.fromEntries(allStatuses.map(s => [s.id, s]))

    // === KPI: Counts ===
    const [emAndamento, completadasHoje, completadasSemana, completadasMes, garantiasMes, totalCompletadasMes, totalGeral, totalCompletadasGeral] = await Promise.all([
      prisma.serviceOrder.count({ where: { company_id: cid, technician_id: techId, deleted_at: null, status_id: { notIn: finalIds } } }),
      prisma.serviceOrder.count({ where: { company_id: cid, technician_id: techId, deleted_at: null, status_id: { in: finalIds }, updated_at: { gte: todayStart, lt: todayEnd } } }),
      prisma.serviceOrder.count({ where: { company_id: cid, technician_id: techId, deleted_at: null, status_id: { in: finalIds }, updated_at: { gte: weekStart } } }),
      prisma.serviceOrder.count({ where: { company_id: cid, technician_id: techId, deleted_at: null, status_id: { in: finalIds }, updated_at: { gte: monthStart } } }),
      prisma.serviceOrder.count({ where: { company_id: cid, technician_id: techId, deleted_at: null, is_warranty: true } }),
      prisma.serviceOrder.count({ where: { company_id: cid, technician_id: techId, deleted_at: null, status_id: { in: finalIds }, updated_at: { gte: monthStart } } }),
      prisma.serviceOrder.count({ where: { company_id: cid, technician_id: techId, deleted_at: null } }),
      prisma.serviceOrder.count({ where: { company_id: cid, technician_id: techId, deleted_at: null, status_id: { in: finalIds } } }),
    ])

    const taxaGarantia = totalCompletadasGeral > 0 ? Math.round((garantiasMes / totalCompletadasGeral) * 100) : 0

    // === PRAZO: Vencendo hoje / Atrasadas / No prazo ===
    const pendingOS = await prisma.serviceOrder.findMany({
      where: { company_id: cid, technician_id: techId, deleted_at: null, status_id: { notIn: finalIds } },
      select: { id: true, os_number: true, estimated_delivery: true, created_at: true, priority: true, status_id: true,
        equipment_type: true, equipment_brand: true, equipment_model: true, reported_issue: true, total_cost: true,
        customers: { select: { legal_name: true } } },
      orderBy: { created_at: 'asc' },
    })

    let atrasadas = 0, vencendoHoje = 0, noPrazo = 0, semPrazo = 0
    const filaTrabalho = pendingOS.map(os => {
      const est = os.estimated_delivery ? new Date(os.estimated_delivery) : null
      let prazoStatus: 'atrasada' | 'hoje' | 'no_prazo' | 'sem_prazo' = 'sem_prazo'
      if (est) {
        const estDate = new Date(est); estDate.setHours(0, 0, 0, 0)
        if (estDate < todayStart) { prazoStatus = 'atrasada'; atrasadas++ }
        else if (estDate.getTime() === todayStart.getTime()) { prazoStatus = 'hoje'; vencendoHoje++ }
        else { prazoStatus = 'no_prazo'; noPrazo++ }
      } else { semPrazo++ }

      const st = statusMap[os.status_id]
      return {
        id: os.id, os_number: os.os_number, priority: os.priority,
        equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
        customer: os.customers?.legal_name || '—',
        reported_issue: os.reported_issue?.substring(0, 80) || '—',
        status: st?.name || '—', status_color: st?.color || '#888',
        estimated_delivery: os.estimated_delivery,
        total_cost: os.total_cost || 0,
        prazo_status: prazoStatus,
        created_at: os.created_at,
      }
    })

    // Sort: atrasadas primeiro, depois hoje, depois por prioridade
    const prioOrder: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
    const prazoOrder: Record<string, number> = { atrasada: 0, hoje: 1, no_prazo: 2, sem_prazo: 3 }
    filaTrabalho.sort((a, b) => (prazoOrder[a.prazo_status || ''] ?? 9) - (prazoOrder[b.prazo_status || ''] ?? 9) || (prioOrder[a.priority || ''] ?? 9) - (prioOrder[b.priority || ''] ?? 9))

    // === TEMPO MÉDIO DE REPARO (últimos 30 dias) ===
    const avgResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (so.updated_at - so.created_at)) / 3600), 1)::float AS avg_hours,
        ROUND(AVG(EXTRACT(EPOCH FROM (so.updated_at - so.created_at)) / 86400), 1)::float AS avg_days
      FROM service_orders so
      WHERE so.company_id = $1
        AND so.technician_id = $2
        AND so.deleted_at IS NULL
        AND so.status_id = ANY($3::text[])
        AND so.updated_at >= $4::timestamptz
    `, cid, techId, finalIds, monthStart)

    const avgRepairHours = Number(avgResult[0]?.avg_hours) || 0
    const avgRepairDays = Number(avgResult[0]?.avg_days) || 0

    // === TOP EQUIPAMENTOS (últimos 90 dias) ===
    const equipResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT equipment_type, COUNT(*)::int AS count
      FROM service_orders
      WHERE company_id = $1 AND technician_id = $2 AND deleted_at IS NULL
        AND equipment_type IS NOT NULL AND equipment_type != ''
        AND created_at >= $3::timestamptz
      GROUP BY equipment_type
      ORDER BY count DESC
      LIMIT 5
    `, cid, techId, new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000))

    // === POR STATUS (pipeline do técnico) ===
    const pipelineResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT so.status_id, COUNT(*)::int AS count
      FROM service_orders so
      WHERE so.company_id = $1 AND so.technician_id = $2 AND so.deleted_at IS NULL
        AND so.status_id != ALL($3::text[])
      GROUP BY so.status_id
    `, cid, techId, finalIds)

    const pipeline = pipelineResult.map(r => {
      const st = statusMap[r.status_id]
      return { name: st?.name || '?', color: st?.color || '#888', count: Number(r.count) }
    }).sort((a, b) => b.count - a.count)

    // === ÚLTIMAS COMPLETADAS ===
    const recentCompleted = await prisma.serviceOrder.findMany({
      where: { company_id: cid, technician_id: techId, deleted_at: null, status_id: { in: finalIds } },
      select: { id: true, os_number: true, equipment_type: true, equipment_brand: true, total_cost: true, updated_at: true,
        customers: { select: { legal_name: true } } },
      orderBy: { updated_at: 'desc' },
      take: 5,
    })

    return success({
      cards: {
        em_andamento: emAndamento,
        completadas_hoje: completadasHoje,
        completadas_semana: completadasSemana,
        completadas_mes: completadasMes,
        taxa_garantia: taxaGarantia,
        garantias_mes: garantiasMes,
        total_geral: totalGeral,
        total_completadas: totalCompletadasGeral,
      },
      prazo: { atrasadas, vencendo_hoje: vencendoHoje, no_prazo: noPrazo, sem_prazo: semPrazo },
      performance: { avg_repair_hours: avgRepairHours, avg_repair_days: avgRepairDays },
      fila_trabalho: filaTrabalho,
      pipeline,
      top_equipamentos: equipResult.map(r => ({ type: r.equipment_type, count: Number(r.count) })),
      recent_completed: recentCompleted.map(r => ({
        id: r.id, os_number: r.os_number,
        equipment: [r.equipment_type, r.equipment_brand].filter(Boolean).join(' '),
        customer: r.customers?.legal_name || '—',
        total_cost: r.total_cost || 0,
        completed_at: r.updated_at,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
