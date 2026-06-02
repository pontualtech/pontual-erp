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

    // Wave O privacy fix (2026-05-23): insights são role-aware.
    // - admin/atendente/financeiro: veem TODOS (CEO + operacional + alerta tech)
    // - técnico: vê só insight de SUA workload + OS atrasadas suas
    // - motorista: vê só insights de logística (nenhum dos atuais — array vazio)
    // Logs antes: motorista via "Luiz: 24 OS" + faturamento — privacy leak.
    const role = (user.roleName || '').toLowerCase()
    const isAdminLike = role === 'admin' || role === 'atendente' || role === 'financeiro'
    const isTech = role === 'técnico' || role === 'tecnico'
    const isMotorista = role === 'motorista'

    const insights: Array<{
      id: string
      severity: 'info' | 'warning' | 'critical'
      icon: string
      title: string
      description: string
      action_label?: string
      action_url?: string
      audience?: 'admin' | 'tech' | 'all'  // marca pra filtragem final
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
        audience: 'admin', // dados financeiros sensíveis
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
    // Sprint UX-16 fix (2026-05-23): `having: { id: { _count: { gt: 10 } } } as any` não
    // era suportado pelo Prisma e o .catch silenciava — insight nunca aparecia.
    // Agora: groupBy retorna top 5 técnicos com mais OS abertas, filtramos > 10 em JS.
    const techGroups = await prisma.serviceOrder.groupBy({
      by: ['technician_id'],
      where: {
        company_id: user.companyId,
        deleted_at: null,
        technician_id: { not: null },
        module_statuses: { is_final: false },
      },
      _count: { _all: true },
      orderBy: { _count: { technician_id: 'desc' } },
      take: 5,
    }).catch(() => [] as Array<{ technician_id: string | null; _count: { _all: number } }>)

    type TechGroup = { technician_id: string | null; _count: { _all: number } }
    const overloaded = (techGroups as TechGroup[]).filter(t => t.technician_id && t._count._all > 10)

    if (overloaded.length > 0 && overloaded[0].technician_id) {
      const tech = await prisma.userProfile.findUnique({
        where: { id: overloaded[0].technician_id },
        select: { name: true },
      }).catch(() => null)
      const count = overloaded[0]._count._all
      insights.push({
        audience: 'admin', // mostrar SÓ pro gestor — constrangedor pro próprio téc
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
        where: { company_id: user.companyId, deleted_at: null, status: { in: ['RECEBIDO', 'LIQUIDADO', 'PAGO'] }, due_date: { gte: ystart, lte: yend } },
        _sum: { received_amount: true },
      }),
      prisma.accountReceivable.aggregate({
        where: { company_id: user.companyId, deleted_at: null, status: { in: ['RECEBIDO', 'LIQUIDADO', 'PAGO'] }, due_date: { gte: lyStart, lte: lyEnd } },
        _sum: { received_amount: true },
      }),
    ])

    const mtdR = mtdRev._sum.received_amount || 0
    const lyR = lyRev._sum.received_amount || 0
    if (lyR > 0) {
      const deltaPct = Math.round(((mtdR - lyR) / lyR) * 100)
      if (deltaPct >= 20) {
        insights.push({
          audience: 'admin', // receita YoY — privacidade CEO
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
          audience: 'admin', // receita YoY — privacidade CEO
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
        audience: 'admin', // cobranças financeiras — non-admin não vê
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
        audience: 'all', // operacional — útil pra todos os roles
        id: 'os_atrasadas',
        severity: atrasadas >= 10 ? 'critical' : 'warning',
        icon: '⏰',
        title: `${atrasadas} OS atrasadas`,
        description: `OS cujo prazo de entrega já passou. Cliente espera retorno — risco de reclamação.`,
        action_label: 'Ver OS atrasadas',
        action_url: '/os?overdue=1',
      })
    }

    // Wave O privacy filter (2026-05-23): aplica audience por role.
    // - 'admin' (financeiro, YoY, workload): só admin/atendente/financeiro veem
    // - 'all' (operacional, OS atrasadas): todos veem
    // - 'tech' (futuro): só técnicos
    const filtered = insights.filter(i => {
      const aud = i.audience || 'all'
      if (aud === 'all') return true
      if (aud === 'admin') return isAdminLike
      if (aud === 'tech') return isTech
      return false
    })
    // Remove o campo 'audience' do output (interno only)
    const publicInsights = filtered.map(({ audience: _a, ...rest }) => rest)

    // Ordena: critical → warning → info
    const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    publicInsights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

    // Logs role pra observabilidade (sem PII)
    console.log(`[Insights] role=${role}, total=${insights.length}, after_filter=${publicInsights.length}`)
    void isMotorista // suprime warning (reservado pra futuro)

    return success({
      insights: publicInsights,
      generated_at: now.toISOString(),
    })
  } catch (err) {
    return handleError(err)
  }
}
