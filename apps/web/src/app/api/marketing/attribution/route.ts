import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { getGoogleAdsTotalCostCents, enrichGclids, getGoogleAdsCampaignCosts } from '@/lib/google-ads-enrichment'

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

const RANGES_DAYS: Record<string, number> = { 'today': 1, '1d': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365, '1y': 365 }

/** Parse YYYY-MM-DD pra Date no início do dia BRT (UTC-3). Retorna null se inválido. */
function parseDateBR(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00-03:00`)
  return isNaN(d.getTime()) ? null : d
}

type ChannelKey = 'google_ads' | 'microsoft_ads' | 'meta_ads' | 'linkedin_ads' | 'x_ads' | 'tiktok_ads' | 'organic' | 'direct' | 'email' | 'referral' | 'social' | 'other' | 'sem_tracking'

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

function classifyChannel(
  source: string | null, medium: string | null,
  gclid: string | null, msclkid: string | null,
  fbclid: string | null = null, liFatId: string | null = null,
  twclid: string | null = null, ttclid: string | null = null,
): ChannelKey {
  // CLIDs têm precedência — captura mais determinística do que utm_source
  if (gclid) return 'google_ads'
  if (msclkid) return 'microsoft_ads'
  if (fbclid) return 'meta_ads'
  if (liFatId) return 'linkedin_ads'
  if (twclid) return 'x_ads'
  if (ttclid) return 'tiktok_ads'
  if (!source && !medium) return 'sem_tracking'
  const sm = `${source || ''} / ${medium || ''}`.toLowerCase()
  if (/google\s*\/\s*cpc/.test(sm) || /google\s*\/\s*paid/.test(sm)) return 'google_ads'
  if (/bing\s*\/\s*cpc/.test(sm) || /microsoft\s*\/\s*cpc/.test(sm)) return 'microsoft_ads'
  if (/(facebook|instagram|meta|fb)\s*\/\s*(cpc|paid_social|paid)/.test(sm)) return 'meta_ads'
  if (/linkedin\s*\/\s*(cpc|paid_social|paid)/.test(sm)) return 'linkedin_ads'
  if (/(twitter|^x)\s*\/\s*(cpc|paid_social|paid)/.test(sm)) return 'x_ads'
  if (/tiktok\s*\/\s*(cpc|paid_social|paid)/.test(sm)) return 'tiktok_ads'
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
  meta_ads:      { label: 'Meta Ads',         emoji: '🟦', order: 3 },
  linkedin_ads:  { label: 'LinkedIn Ads',     emoji: '💼', order: 4 },
  x_ads:         { label: 'X Ads',            emoji: '✖️', order: 5 },
  tiktok_ads:    { label: 'TikTok Ads',       emoji: '🎵', order: 6 },
  organic:       { label: 'Orgânico',         emoji: '🌱', order: 7 },
  email:         { label: 'Email',            emoji: '📧', order: 8 },
  social:        { label: 'Social orgânico',  emoji: '📱', order: 9 },
  direct:        { label: 'Direto',           emoji: '🔘', order: 10 },
  referral:      { label: 'Referral',         emoji: '🔗', order: 11 },
  other:         { label: 'Outros',           emoji: '⚪', order: 12 },
  sem_tracking:  { label: 'Sem tracking',     emoji: '❓', order: 13 },
}

export async function GET(req: NextRequest) {
  try {
    // Wave O privacy fix (2026-05-23): trocado de 'dashboard:view' (todos roles)
    // para 'marketing:view' pra esconder receita+CAC+ROI de motorista/técnico.
    const result = await requirePermission('marketing', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cId = user.companyId
    // Custom range (2026-05-29): aceita ?from=YYYY-MM-DD&to=YYYY-MM-DD além de ?range=Xd.
    // Custom vence quando ambos from e to são válidos. range fallback default 30d.
    const fromParam = parseDateBR(req.nextUrl.searchParams.get('from'))
    const toParam = parseDateBR(req.nextUrl.searchParams.get('to'))
    let range: string
    let since: Date
    let until: Date
    if (fromParam && toParam) {
      // Swap se invertido pra tolerar erro de UX
      since = fromParam <= toParam ? fromParam : toParam
      // until: fim do dia do toParam (23:59:59) pra incluir o dia inteiro
      const endOfToDay = new Date(Math.max(fromParam.getTime(), toParam.getTime()))
      endOfToDay.setUTCHours(endOfToDay.getUTCHours() + 24) // próximo dia 00:00 BRT
      until = endOfToDay
      range = `custom:${since.toISOString().slice(0,10)}_${(new Date(until.getTime() - 86400_000)).toISOString().slice(0,10)}`
    } else {
      range = req.nextUrl.searchParams.get('range') || '30d'
      const days = RANGES_DAYS[range] ?? 30
      // "today" significa "hoje a partir de 00:00 BRT" (não 24h rolling como '1d').
      // BRT = UTC-3. Início do dia BRT = data atual com hora zerada em BRT, depois +3h pra UTC.
      if (range === 'today') {
        const nowUtc = new Date()
        const brtMidnight = new Date(nowUtc.getTime() - 3 * 3600 * 1000)
        brtMidnight.setUTCHours(0, 0, 0, 0)
        since = new Date(brtMidnight.getTime() + 3 * 3600 * 1000) // de volta pra UTC
      } else {
        since = new Date(Date.now() - days * 86400 * 1000)
      }
      until = new Date()
    }

    const orders = await prisma.serviceOrder.findMany({
      where: {
        company_id: cId,
        created_at: { gte: since, lte: until },
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
        tracking.fbclid ?? null,
        tracking.li_fat_id ?? null,
        tracking.twclid ?? null,
        tracking.ttclid ?? null,
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

    // Constrói timeline preenchendo dias vazios entre since e until (era 'now',
    // agora respeita range custom passado pelo usuário).
    const timeline: Array<{ date: string } & Partial<Record<ChannelKey, number>>> = []
    for (let d = new Date(since); d <= until; d = new Date(d.getTime() + 86400_000)) {
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
    // Frente E (2026-05-29) + Custom range: passa from/to direto.
    // Manual sempre vence (Karlão pode forçar valor pra simular cenários).
    const investmentSources: Record<string, 'manual' | 'google_ads_api'> = {}
    for (const ch of Object.keys(investments)) investmentSources[ch] = 'manual'
    if (!investments['google_ads']) {
      const auto = await getGoogleAdsTotalCostCents({ from: since, to: until }).catch(() => null)
      if (auto && auto > 0) {
        investments['google_ads'] = auto
        investmentSources['google_ads'] = 'google_ads_api'
      }
    }

    // Anexa CAC em cada item do breakdown
    // Bug-hunt humano (2026-05-23): se investment === 0, CAC era 0 (matematicamente
    // correto mas semanticamente errado — usuário lia "R$ 0,00" como custo zero).
    // Agora CAC é null quando investment===0 OU approved===0. Renderiza "—" na UI.
    const breakdownWithCac = breakdown.map(b => {
      const investment = investments[b.channel] || 0
      const cac = (investment > 0 && b.approved_count > 0) ? Math.round(investment / b.approved_count) : null
      const roi = investment > 0 ? Math.round((b.approved_revenue_cents - investment) / investment * 100) : null
      return {
        ...b,
        investment_cents: investment,
        investment_source: investmentSources[b.channel] || null,
        cac_cents: cac,
        roi_pct: roi,
      }
    })

    // Nurture journey stats (2026-05-29 Frente C): contadores agregados de leads
    // capturados via bot isca + outros. Mostra ativos vs reativados (= viraram OS).
    const journeyStats = await prisma.marketingJourney.groupBy({
      by: ['journey_type', 'outcome'],
      where: { company_id: cId },
      _count: { id: true },
    }).then(rows => {
      const result: Record<string, { active: number; reactivated: number; other_ended: number }> = {}
      for (const r of rows) {
        const type = r.journey_type
        if (!result[type]) result[type] = { active: 0, reactivated: 0, other_ended: 0 }
        if (r.outcome === null) result[type].active += r._count.id
        else if (r.outcome === 'reactivated') result[type].reactivated += r._count.id
        else result[type].other_ended += r._count.id
      }
      return result
    }).catch(() => ({} as Record<string, { active: number; reactivated: number; other_ended: number }>))

    // ── Atribuição por CAMPANHA (2026-06-03) ─────────────────────────────
    // Liga campanha ao DINHEIRO (OS→aprovada→R$→CPA), não só canal. Campanha =
    // utm_campaign direto; senão gclid enriquecido via Google Ads API (best-effort,
    // dia ≈ created_at da OS). Custo/CPA por campanha do Google via API. Honesto:
    // o que não resolve cai em "(campanha não identificada)".
    type CampaignRow = {
      channel: ChannelKey; label: string; emoji: string; campaign: string
      os_count: number; approved_count: number; approved_revenue_cents: number
      cost_cents: number | null; cpa_cents: number | null
    }
    const gclidEnrich: { gclid: string; clickAt: Date }[] = []
    const campPending: { channel: ChannelKey; campaign: string | null; gclid: string | null; approved: number }[] = []
    for (const os of orders) {
      const t = (os.custom_data as any)?.tracking || {}
      const channel = classifyChannel(
        t.utm_source ?? null, t.utm_medium ?? null, t.gclid ?? null, t.msclkid ?? null,
        t.fbclid ?? null, t.li_fat_id ?? null, t.twclid ?? null, t.ttclid ?? null,
      )
      if (channel === 'sem_tracking') continue
      const campaign = (t.utm_campaign && String(t.utm_campaign).trim()) || null
      const gclid = (channel === 'google_ads' && !campaign && t.gclid) ? String(t.gclid) : null
      if (gclid) gclidEnrich.push({ gclid, clickAt: os.created_at ?? new Date() })
      campPending.push({ channel, campaign, gclid, approved: os.approved_cost ?? 0 })
    }
    const enrichMap: Map<string, { campaignName: string | null; adGroupName: string | null }> =
      gclidEnrich.length > 0 ? await enrichGclids(gclidEnrich).catch(() => new Map()) : new Map()
    const campaignCosts = await getGoogleAdsCampaignCosts({ from: since, to: until }).catch(() => null)
    const campMap = new Map<string, CampaignRow>()
    for (const p of campPending) {
      let campaign = p.campaign
      if (!campaign && p.gclid) campaign = enrichMap.get(p.gclid.replace(/\*/g, '_'))?.campaignName || null
      const campName = campaign || '(campanha não identificada)'
      const key = `${p.channel}|${campName}`
      let row = campMap.get(key)
      if (!row) {
        row = {
          channel: p.channel, label: CHANNEL_META[p.channel].label, emoji: CHANNEL_META[p.channel].emoji,
          campaign: campName, os_count: 0, approved_count: 0, approved_revenue_cents: 0, cost_cents: null, cpa_cents: null,
        }
        campMap.set(key, row)
      }
      row.os_count++
      if (p.approved > 0) { row.approved_count++; row.approved_revenue_cents += p.approved }
    }
    if (campaignCosts) {
      for (const row of campMap.values()) {
        if (row.campaign === '(campanha não identificada)') continue
        const c = campaignCosts.get(row.campaign)
        if (c != null && c > 0) {
          row.cost_cents = c
          row.cpa_cents = row.approved_count > 0 ? Math.round(c / row.approved_count) : null
        }
      }
    }
    const campaigns = Array.from(campMap.values()).sort((a, b) => b.os_count - a.os_count)

    return success({
      range,
      since: since.toISOString(),
      totals,
      breakdown: breakdownWithCac,
      campaigns,
      timeline,
      coverage_pct: totals.os_count > 0 ? (totals.tracked_count / totals.os_count) * 100 : 0,
      investments,
      investment_sources: investmentSources,
      nurture_journeys: journeyStats,
    })
  } catch (e) {
    return handleError(e)
  }
}
