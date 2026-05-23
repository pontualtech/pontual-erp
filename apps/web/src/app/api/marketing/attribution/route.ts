import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * Returns OS × Aprovações × Canal breakdown for marketing attribution.
 *
 * Sources of truth (modelo REAL do ERP — não usa Quote table):
 *  - service_orders.custom_data->tracking->utm_source/medium/gclid/msclkid
 *    (populated via CWT tag + bot Marta since 2026-05-21)
 *  - service_orders.approved_cost (centavos) > 0 = OS aprovada pelo cliente
 *  - service_orders.total_cost (centavos) = valor cobrado/faturado
 *
 * Karlão: "dos clientes que aprovaram OS, quantos vieram do Google, MS Ads, etc."
 */

const RANGES_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }

type ChannelKey = 'google_ads' | 'microsoft_ads' | 'organic' | 'direct' | 'email' | 'referral' | 'social' | 'other' | 'sem_tracking'

type OrderRef = {
  os_id: string
  os_number: number
  customer_name: string | null
  approved_cost: number
  total_cost: number
  created_at: string
  approved: boolean
}

type ChannelStats = {
  channel: ChannelKey
  label: string
  emoji: string
  os_count: number
  approved_count: number       // OS com approved_cost > 0
  approval_rate: number        // approved_count / os_count
  approved_revenue_cents: number  // SUM(approved_cost)
  total_revenue_cents: number     // SUM(total_cost)
  top_orders: OrderRef[]       // top 10 OS no canal (ordenadas por approved_cost desc)
}

function classifyChannel(source: string | null, medium: string | null, gclid: string | null, msclkid: string | null): ChannelKey {
  if (gclid) return 'google_ads'
  if (msclkid) return 'microsoft_ads'
  if (!source && !medium) return 'sem_tracking'
  const sm = `${source || ''} / ${medium || ''}`.toLowerCase()
  if (/google\s*\/\s*cpc/.test(sm) || /google\s*\/\s*paid/.test(sm)) return 'google_ads'
  if (/bing\s*\/\s*cpc/.test(sm) || /microsoft\s*\/\s*cpc/.test(sm)) return 'microsoft_ads'
  if (/\/\s*organic/.test(sm)) return 'organic'
  if (/\/\s*email/.test(sm) || /mautic/.test(sm)) return 'email'
  if (/(facebook|instagram|linkedin|tiktok|youtube)/.test(sm)) return 'social'
  if (sm.startsWith('(direct)')) return 'direct'
  if (/\/\s*referral/.test(sm)) return 'referral'
  return 'other'
}

const CHANNEL_META: Record<ChannelKey, { label: string; emoji: string; order: number }> = {
  google_ads:    { label: 'Google Ads',       emoji: '🔵', order: 1 },
  microsoft_ads: { label: 'Microsoft Ads',    emoji: '🔷', order: 2 },
  organic:       { label: 'Orgânico',         emoji: '🌱', order: 3 },
  email:         { label: 'Email',            emoji: '📧', order: 4 },
  social:        { label: 'Social',           emoji: '📱', order: 5 },
  direct:        { label: 'Direto',           emoji: '🔘', order: 6 },
  referral:      { label: 'Referral',         emoji: '🔗', order: 7 },
  other:         { label: 'Outros',           emoji: '⚪', order: 8 },
  sem_tracking:  { label: 'Sem tracking',     emoji: '❓', order: 9 },
}

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cId = user.companyId
    const range = req.nextUrl.searchParams.get('range') || '30d'
    const days = RANGES_DAYS[range] ?? 30
    const since = new Date(Date.now() - days * 86400 * 1000)

    const orders = await prisma.serviceOrder.findMany({
      where: {
        company_id: cId,
        created_at: { gte: since },
        deleted_at: null,
      },
      select: {
        id: true,
        os_number: true,
        custom_data: true,
        approved_cost: true,
        total_cost: true,
        created_at: true,
        customers: { select: { legal_name: true } },
      },
    })

    const buckets: Record<ChannelKey, ChannelStats> = {} as any
    for (const key of Object.keys(CHANNEL_META) as ChannelKey[]) {
      buckets[key] = {
        channel: key,
        label: CHANNEL_META[key].label,
        emoji: CHANNEL_META[key].emoji,
        os_count: 0,
        approved_count: 0,
        approval_rate: 0,
        approved_revenue_cents: 0,
        total_revenue_cents: 0,
        top_orders: [],
      }
    }

    // Coleta orders por canal (sem limit ainda — vamos cortar top 10 por canal depois)
    const allByChannel: Record<ChannelKey, OrderRef[]> = {} as any
    for (const key of Object.keys(CHANNEL_META) as ChannelKey[]) allByChannel[key] = []

    // Timeline: data (YYYY-MM-DD) → channel → { os_count, approved_count, approved_revenue_cents }
    const timelineMap: Record<string, Partial<Record<ChannelKey, { os_count: number; approved_count: number; approved_revenue_cents: number }>>> = {}

    for (const os of orders) {
      const cd = os.custom_data as any
      const tracking = cd?.tracking || {}
      const channel = classifyChannel(
        tracking.utm_source ?? null,
        tracking.utm_medium ?? null,
        tracking.gclid ?? null,
        tracking.msclkid ?? null,
      )
      const b = buckets[channel]
      b.os_count++
      const approved = (os.approved_cost ?? 0)
      const totalCost = (os.total_cost ?? 0)
      if (approved > 0) {
        b.approved_count++
        b.approved_revenue_cents += approved
      }
      b.total_revenue_cents += totalCost
      allByChannel[channel].push({
        os_id: os.id,
        os_number: os.os_number,
        customer_name: os.customers?.legal_name ?? null,
        approved_cost: approved,
        total_cost: totalCost,
        created_at: (os.created_at ?? new Date()).toISOString(),
        approved: approved > 0,
      })
      // Timeline bucket
      const dateKey = (os.created_at ?? new Date()).toISOString().slice(0, 10)
      if (!timelineMap[dateKey]) timelineMap[dateKey] = {}
      const t = timelineMap[dateKey][channel] ?? { os_count: 0, approved_count: 0, approved_revenue_cents: 0 }
      t.os_count++
      if (approved > 0) {
        t.approved_count++
        t.approved_revenue_cents += approved
      }
      timelineMap[dateKey][channel] = t
    }

    // Top 10 OS por canal: ordena por approved_cost desc, depois total_cost desc, depois data desc
    for (const key of Object.keys(buckets) as ChannelKey[]) {
      const sorted = allByChannel[key].sort((a, b) => {
        if (b.approved_cost !== a.approved_cost) return b.approved_cost - a.approved_cost
        if (b.total_cost !== a.total_cost) return b.total_cost - a.total_cost
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      buckets[key].top_orders = sorted.slice(0, 10)
    }

    for (const key of Object.keys(buckets) as ChannelKey[]) {
      const b = buckets[key]
      b.approval_rate = b.os_count > 0 ? b.approved_count / b.os_count : 0
    }

    const breakdown = Object.values(buckets)
      .filter(b => b.os_count > 0)
      .sort((a, b) => {
        if (a.channel === 'sem_tracking') return 1
        if (b.channel === 'sem_tracking') return -1
        return b.os_count - a.os_count
      })

    const totals = {
      os_count: orders.length,
      approved_count: orders.filter(o => (o.approved_cost ?? 0) > 0).length,
      approved_revenue_cents: orders.reduce((a, o) => a + (o.approved_cost ?? 0), 0),
      total_revenue_cents: orders.reduce((a, o) => a + (o.total_cost ?? 0), 0),
      tracked_count: orders.filter(o => {
        const t = (o.custom_data as any)?.tracking || {}
        return t.utm_source || t.utm_medium || t.gclid || t.msclkid
      }).length,
    }

    // Constrói timeline preenchendo dias vazios entre since e hoje
    const timeline: Array<{ date: string } & Partial<Record<ChannelKey, number>>> = []
    const now = new Date()
    for (let d = new Date(since); d <= now; d = new Date(d.getTime() + 86400_000)) {
      const dateKey = d.toISOString().slice(0, 10)
      const dayData = timelineMap[dateKey] || {}
      const row: any = { date: dateKey }
      for (const key of Object.keys(CHANNEL_META) as ChannelKey[]) {
        if (key === 'sem_tracking') continue
        row[key] = dayData[key]?.os_count || 0
      }
      timeline.push(row)
    }

    // Sprint UX-16 (2026-05-23): CAC por canal — investimento manual configurado
    // em settings `marketing.investment.{channel}` (centavos por mês).
    // CAC_canal = investimento / approved_count.
    const investmentSettings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { startsWith: 'marketing.investment.' } },
      select: { key: true, value: true },
    })
    const investments: Record<string, number> = {}
    for (const s of investmentSettings) {
      const channel = s.key.replace('marketing.investment.', '')
      investments[channel] = parseInt(s.value) || 0
    }

    // Anexa CAC em cada item do breakdown
    const breakdownWithCac = breakdown.map(b => {
      const investment = investments[b.channel] || 0
      const cac = b.approved_count > 0 ? Math.round(investment / b.approved_count) : null
      const roi = investment > 0 ? Math.round((b.approved_revenue_cents - investment) / investment * 100) : null
      return { ...b, investment_cents: investment, cac_cents: cac, roi_pct: roi }
    })

    return success({
      range,
      since: since.toISOString(),
      totals,
      breakdown: breakdownWithCac,
      timeline,
      coverage_pct: totals.os_count > 0 ? (totals.tracked_count / totals.os_count) * 100 : 0,
      investments,
    })
  } catch (e) {
    return handleError(e)
  }
}
