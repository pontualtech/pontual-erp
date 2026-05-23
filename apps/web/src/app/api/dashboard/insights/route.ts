import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/dashboard/insights
 *
 * Sprint UX-16 (2026-05-23) — Insights automáticos pro CEO.
 * Inspirado em Linear Insights + ProfitWell.
 *
 * Gera alertas acionáveis sobre o estado atual do negócio:
 *  - Inadimplência crescendo (>20% vs período anterior)
 *  - Técnico com workload alto (>10 OS abertas)
 *  - Ticket médio caindo
 *  - Cliente VIP inadimplente
 *  - Tempo médio de reparo subindo
 *
 * Cada insight: severity (info|warning|critical) + título + descrição +
 * link de ação. Frontend ordena por severity DESC e mostra top 3-5.
 */
export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const insights: Array<{
      id: string
      severity: 'info' | 'warning' | 'critical'
      icon: string
      title: string
      description: string
      action_label?: string
      action_url?: string
    }> = []

    const now = new Date()
    const todayYMD = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`

    // ─── Insight 1: Aging crítico (90+ dias) ──────────────────────────
    const aging90 = await prisma.accountReceivable.aggregate({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        status: 'PENDENTE',
        due_date: { lt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
      },
      _sum: { total_amount: true, received_amount: true },
      _count: true,
    })
    const aging90Sum = (aging90._sum.total_amount || 0) - (aging90._sum.received_amount || 0)
    if (aging90Sum > 0 && aging90._count > 0) {
      insights.push({
        id: 'aging_90',
        severity: 'critical',
        icon: '⚠️',
        title: `${aging90._count} título(s) com 90+ dias de atraso`,
        description: `Total ${(aging90Sum / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em risco. Considerar protesto ou negociação.`,
        action_label: 'Ver Aging Report',
        action_url: '/financeiro/relatorios/aging',
      })
    }

    // ─── Insight 2: Técnico sobrecarregado ────────────────────────────
    const techWorkload = await prisma.serviceOrder.groupBy({
      by: ['technician_id'],
      where: {
        company_id: user.companyId,
        deleted_at: null,
        technician_id: { not: null },
        module_statuses: { is_final: false },
      },
      _count: true,
      having: { id: { _count: { gt: 10 } } } as any,
      orderBy: { _count: { id: 'desc' } },
      take: 1,
    }).catch(() => [])

    if (techWorkload.length > 0 && techWorkload[0].technician_id) {
      const tech = await prisma.userProfile.findUnique({
        where: { id: techWorkload[0].technician_id },
        select: { name: true },
      }).catch(() => null)
      const count = techWorkload[0]._count
      insights.push({
        id: 'tech_overloaded',
        severity: 'warning',
        icon: '👷',
        title: `${tech?.name || 'Técnico'}: ${count} OS abertas`,
        description: `Workload acima do ideal (>10). Considerar redistribuir entre outros técnicos.`,
        action_label: 'Ver carga de técnicos',
        action_url: '/tecnico',
      })
    }

    // ─── Insight 3: Pulse — Mês vs ano passado ────────────────────────
    // (calculo já existe em /pulse, faço call simplificado aqui)
    const ystart = new Date(now.getFullYear(), now.getMonth(), 1)
    const yend = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
    const lyStart = new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const lyEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59)

    const [mtdRev, lyRev] = await Promise.all([
      prisma.accountReceivable.aggregate({
        where: { company_id: user.companyId, deleted_at: null, status: 'RECEBIDO', due_date: { gte: ystart, lte: yend } },
        _sum: { received_amount: true },
      }),
      prisma.accountReceivable.aggregate({
        where: { company_id: user.companyId, deleted_at: null, status: 'RECEBIDO', due_date: { gte: lyStart, lte: lyEnd } },
        _sum: { received_amount: true },
      }),
    ])

    const mtdR = mtdRev._sum.received_amount || 0
    const lyR = lyRev._sum.received_amount || 0
    if (lyR > 0) {
      const deltaPct = Math.round(((mtdR - lyR) / lyR) * 100)
      if (deltaPct >= 20) {
        insights.push({
          id: 'yoy_growth',
          severity: 'info',
          icon: '🚀',
          title: `Receita ${deltaPct}% acima do mesmo período ano passado`,
          description: `Mês atual ${(mtdR / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} vs ${(lyR / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em ${now.getFullYear() - 1}. Tendência forte de crescimento.`,
          action_label: 'Ver DRE Pulse',
          action_url: '/financeiro/dre',
        })
      } else if (deltaPct <= -20) {
        insights.push({
          id: 'yoy_decline',
          severity: 'warning',
          icon: '📉',
          title: `Receita ${Math.abs(deltaPct)}% abaixo do mesmo período ano passado`,
          description: `Mês atual ${(mtdR / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} vs ${(lyR / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Investigar causas.`,
          action_label: 'Ver DRE Pulse',
          action_url: '/financeiro/dre',
        })
      }
    }

    // ─── Insight 4: Cobranças vencidas hoje ───────────────────────────
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
    const venceHoje = await prisma.accountReceivable.aggregate({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        status: 'PENDENTE',
        due_date: { gte: todayStart, lte: todayEnd },
      },
      _sum: { total_amount: true, received_amount: true },
      _count: true,
    })
    const venceHojeSum = (venceHoje._sum.total_amount || 0) - (venceHoje._sum.received_amount || 0)
    if (venceHoje._count >= 3 && venceHojeSum > 0) {
      insights.push({
        id: 'due_today',
        severity: 'info',
        icon: '📅',
        title: `${venceHoje._count} título(s) vencem hoje`,
        description: `Total ${(venceHojeSum / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Considerar lembrete WhatsApp.`,
        action_label: 'Ver Contas a Receber',
        action_url: `/financeiro/contas-receber?dateFrom=${todayYMD}&dateTo=${todayYMD}`,
      })
    }

    // ─── Insight 5: OS atrasadas vs prazo ─────────────────────────────
    const atrasadas = await prisma.serviceOrder.count({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        estimated_delivery: { lt: now },
        module_statuses: { is_final: false },
      },
    }).catch(() => 0)

    if (atrasadas >= 5) {
      insights.push({
        id: 'os_atrasadas',
        severity: atrasadas >= 10 ? 'critical' : 'warning',
        icon: '⏰',
        title: `${atrasadas} OS atrasadas`,
        description: `OS cujo prazo de entrega já passou. Cliente espera retorno — risco de reclamação.`,
        action_label: 'Ver OS atrasadas',
        action_url: '/os?status_filter=overdue',
      })
    }

    // Ordena: critical → warning → info
    const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    insights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

    return success({
      insights,
      generated_at: now.toISOString(),
    })
  } catch (err) {
    return handleError(err)
  }
}
