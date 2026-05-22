import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

// Next 14: depende de cookies da sessão
export const dynamic = 'force-dynamic'

/**
 * GET /api/marketing/nurture/stats
 *
 * Métricas do módulo nurture:
 *  - KPIs: total capturados, ativas, reativados, conversão %
 *  - Funil: capturados → engajaram → ativas → reativados
 *  - Cohort retention: por mês de captura, % reativados em 30/60/90 dias
 *  - Por equipment_interest: quanto da base se interessa em notebook
 *  - Recentes: últimas 20 jornadas pra inspeção
 */
export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const cId = user.companyId

    // ─────────────────────────────────────────────
    // 1. KPIs básicos
    // ─────────────────────────────────────────────
    const [total, active, ended, reactivated, unsubscribed, bounced, engaged] = await Promise.all([
      prisma.marketingJourney.count({ where: { company_id: cId } }),
      prisma.marketingJourney.count({ where: { company_id: cId, ended_at: null } }),
      prisma.marketingJourney.count({ where: { company_id: cId, ended_at: { not: null } } }),
      prisma.marketingJourney.count({ where: { company_id: cId, outcome: 'reactivated' } }),
      prisma.marketingJourney.count({ where: { company_id: cId, outcome: 'unsubscribed' } }),
      prisma.marketingJourney.count({ where: { company_id: cId, outcome: 'bounced' } }),
      // "Engaged" = recebeu pelo menos 1 step (last_step_at NOT NULL)
      prisma.marketingJourney.count({ where: { company_id: cId, last_step_at: { not: null } } }),
    ])

    const conversion_rate = total > 0 ? Number((reactivated / total * 100).toFixed(2)) : 0
    const engagement_rate = total > 0 ? Number((engaged / total * 100).toFixed(2)) : 0

    // ─────────────────────────────────────────────
    // 2. Cohort retention (por mês de captura)
    // ─────────────────────────────────────────────
    const cohort = await prisma.$queryRaw<Array<{
      cohort_month: string
      captured: bigint
      reactivated_30d: bigint
      reactivated_60d: bigint
      reactivated_90d: bigint
    }>>`
      SELECT
        TO_CHAR(date_trunc('month', mj.started_at), 'YYYY-MM') AS cohort_month,
        COUNT(*) AS captured,
        COUNT(*) FILTER (
          WHERE mj.outcome = 'reactivated'
          AND mj.ended_at - mj.started_at <= interval '30 days'
        ) AS reactivated_30d,
        COUNT(*) FILTER (
          WHERE mj.outcome = 'reactivated'
          AND mj.ended_at - mj.started_at <= interval '60 days'
        ) AS reactivated_60d,
        COUNT(*) FILTER (
          WHERE mj.outcome = 'reactivated'
          AND mj.ended_at - mj.started_at <= interval '90 days'
        ) AS reactivated_90d
      FROM marketing_journeys mj
      WHERE mj.company_id = ${cId}
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 12
    `

    // BigInt → Number (Prisma raw returns bigint)
    const cohort_data = cohort.map(r => ({
      cohort_month: r.cohort_month,
      captured: Number(r.captured),
      reactivated_30d: Number(r.reactivated_30d),
      reactivated_60d: Number(r.reactivated_60d),
      reactivated_90d: Number(r.reactivated_90d),
      rate_30d: Number(r.captured) > 0 ? Number((Number(r.reactivated_30d) / Number(r.captured) * 100).toFixed(2)) : 0,
      rate_60d: Number(r.captured) > 0 ? Number((Number(r.reactivated_60d) / Number(r.captured) * 100).toFixed(2)) : 0,
      rate_90d: Number(r.captured) > 0 ? Number((Number(r.reactivated_90d) / Number(r.captured) * 100).toFixed(2)) : 0,
    }))

    // ─────────────────────────────────────────────
    // 3. Por equipment_interest
    // ─────────────────────────────────────────────
    const interestStats = await prisma.$queryRaw<Array<{
      interest: string
      count: bigint
      reactivated_count: bigint
    }>>`
      SELECT
        jsonb_array_elements_text(
          COALESCE(mj.source_data->'equipments_interest', '["unknown"]'::jsonb)
        ) AS interest,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE mj.outcome = 'reactivated') AS reactivated_count
      FROM marketing_journeys mj
      WHERE mj.company_id = ${cId}
      GROUP BY 1
      ORDER BY 2 DESC
    `

    const by_interest = interestStats.map(r => ({
      interest: r.interest,
      count: Number(r.count),
      reactivated_count: Number(r.reactivated_count),
      rate: Number(r.count) > 0 ? Number((Number(r.reactivated_count) / Number(r.count) * 100).toFixed(2)) : 0,
    }))

    // ─────────────────────────────────────────────
    // 4. Recentes pra inspeção
    // ─────────────────────────────────────────────
    const recent = await prisma.marketingJourney.findMany({
      where: { company_id: cId },
      orderBy: { started_at: 'desc' },
      take: 20,
      include: {
        contact: {
          select: { email: true, name: true, phone: true },
        },
      },
    })

    return success({
      kpis: {
        total,
        active,
        ended,
        reactivated,
        unsubscribed,
        bounced,
        engaged,
        conversion_rate,
        engagement_rate,
      },
      funnel: {
        capturados: total,
        engajaram: engaged,
        ativos: active,
        reativados: reactivated,
      },
      cohort: cohort_data,
      by_interest,
      recent: recent.map(j => ({
        id: j.id,
        contact_email: j.contact.email,
        contact_name: j.contact.name,
        journey_type: j.journey_type,
        current_step: j.current_step,
        started_at: j.started_at,
        last_step_at: j.last_step_at,
        ended_at: j.ended_at,
        outcome: j.outcome,
        equipments_interest: (j.source_data as any)?.equipments_interest || [],
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
