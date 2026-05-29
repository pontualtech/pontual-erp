/**
 * CWT-first channel breakdown — usa marketing_whatsapp_redirects (server-side)
 * como fonte primária, em vez de GA4 (que perde 50-75% atribuição em prod
 * por consent/blockers/ITP).
 *
 * Retorna o mesmo shape ChannelBreakdown do GA4, mais um campo extra
 * `topKeywords` (top 3 utm_term agrupados).
 *
 * Decisão Karlão 2026-05-28: dashboard /marketing/trafego usa CWT primeiro,
 * GA4 vira fallback quando CWT vazio (sites ainda sem F1+F2).
 */

import { prisma } from '@pontual/db'
import type { ChannelBreakdown } from './ga4-data-api'
import { enrichGclids, getGoogleAdsCampaignCosts } from './google-ads-enrichment'

export type CWTBreakdown = ChannelBreakdown & {
  topKeywords: string[]
  // Fase 2 2026-05-28: top 3 nomes de campanha Google Ads (formato "Campaign Name (N)")
  topCampaigns: string[]
}

/**
 * Converte date range estilo GA4 ("today"/"7daysAgo") para Date BRT (UTC-3).
 * BRT 00:00 = UTC 03:00; BRT 23:59 = UTC 02:59 next day.
 */
function ga4DateToBRT(token: string, endOfDay = false): Date {
  const now = new Date()
  let daysAgo = 0
  if (token === 'today') daysAgo = 0
  else if (token === 'yesterday') daysAgo = 1
  else {
    const m = token.match(/^(\d+)daysAgo$/)
    if (m) daysAgo = parseInt(m[1], 10)
  }
  // BRT day boundary em UTC: 03:00 (start) / 02:59 next (end)
  const brtNow = new Date(now.getTime() - 3 * 3600 * 1000) // pretend UTC = BRT
  brtNow.setUTCHours(0, 0, 0, 0)
  brtNow.setUTCDate(brtNow.getUTCDate() - daysAgo)
  if (endOfDay) brtNow.setUTCDate(brtNow.getUTCDate() + 1) // start of next day BRT
  // converter volta pra UTC: BRT+3h
  return new Date(brtNow.getTime() + 3 * 3600 * 1000)
}

function classifyCWTRow(r: {
  gclid: string | null
  msclkid: string | null
  gbraid: string | null
  fbclid: string | null
  li_fat_id: string | null
  twclid: string | null
  ttclid: string | null
  utm_source: string | null
  utm_medium: string | null
}): keyof Omit<ChannelBreakdown, 'total'> {
  // Click IDs têm precedência (mais confiáveis que utm — vêm do próprio Ad)
  if (r.gclid || r.gbraid) return 'google_ads' // gbraid = PMax/Demand Gen
  if (r.msclkid) return 'microsoft_ads'
  if (r.fbclid) return 'meta_ads'
  if (r.li_fat_id) return 'linkedin_ads'
  if (r.twclid) return 'x_ads'
  if (r.ttclid) return 'tiktok_ads'

  const src = (r.utm_source || '').toLowerCase()
  const med = (r.utm_medium || '').toLowerCase()

  if (src === 'google' && (med === 'cpc' || med === 'paid')) return 'google_ads'
  if ((src === 'bing' || src === 'microsoft') && (med === 'cpc' || med === 'paid')) return 'microsoft_ads'
  if ((src === 'facebook' || src === 'instagram' || src === 'meta') && /paid|cpc/.test(med)) return 'meta_ads'
  if (src === 'linkedin' && /paid|cpc/.test(med)) return 'linkedin_ads'
  if ((src === 'twitter' || src === 'x') && /paid|cpc/.test(med)) return 'x_ads'
  if (src === 'tiktok' && /paid|cpc/.test(med)) return 'tiktok_ads'

  if (med === 'email') return 'email'
  if (med === 'organic') return 'organic'
  if (med === 'referral') return 'referral'
  if (/^(facebook|instagram|linkedin|twitter|tiktok|youtube)$/.test(src)) return 'social'

  if (!src && !med) return 'direct'
  return 'other'
}

function emptyBreakdown(): CWTBreakdown {
  return {
    google_ads: 0, microsoft_ads: 0, meta_ads: 0, linkedin_ads: 0,
    x_ads: 0, tiktok_ads: 0,
    organic: 0, direct: 0, email: 0, referral: 0, social: 0, other: 0,
    total: 0,
    topKeywords: [],
    topCampaigns: [],
  }
}

/**
 * Busca breakdown por canal pra um host específico na janela dada.
 * Top 3 utm_term agrupados.
 */
export async function getCWTChannelBreakdown(
  hostname: string,
  dateRange: { startDate: string; endDate: string },
): Promise<CWTBreakdown> {
  const since = ga4DateToBRT(dateRange.startDate)
  const until = ga4DateToBRT(dateRange.endDate, true)

  // Filtra page_url no SQL via LIKE — depois precisão refinada no JS
  const rows = await prisma.marketingWhatsappRedirect.findMany({
    where: {
      click_at: { gte: since, lt: until },
      page_url: { contains: hostname },
    },
    select: {
      gclid: true, msclkid: true, gbraid: true, fbclid: true,
      li_fat_id: true, twclid: true, ttclid: true,
      utm_source: true, utm_medium: true, utm_term: true,
      page_url: true,
      click_at: true,
    },
    take: 5000, // sanity bound; volume diário <1k
  })

  // Refina: hostname exato (LIKE pega substring)
  const result = emptyBreakdown()
  const termCounts: Record<string, number> = {}
  const googleAdsGclids: { gclid: string; clickAt: Date }[] = []
  for (const r of rows) {
    if (!r.page_url) continue
    let host = ''
    try {
      host = new URL(r.page_url).hostname.toLowerCase().replace(/^www\./, '')
    } catch { continue }
    if (host !== hostname) continue

    const channel = classifyCWTRow(r)
    result[channel]++
    result.total++

    if (r.utm_term && r.utm_term.trim()) {
      const term = r.utm_term.trim().toLowerCase()
      termCounts[term] = (termCounts[term] || 0) + 1
    }

    // Fase 2: coleta (gclid, clickAt) de leads classificados como Google Ads.
    // clickAt necessário pra group-by-day na query click_view (Google Ads API exige).
    if (channel === 'google_ads' && r.gclid && r.click_at) {
      googleAdsGclids.push({ gclid: r.gclid, clickAt: r.click_at })
    }
  }

  result.topKeywords = Object.entries(termCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([term, n]) => `${term} (${n})`)

  // Fase 2: enriquece com nomes de campanha Google Ads (cache 24h)
  // A2 (2026-05-29): em paralelo, busca custo por campanha pra mostrar invest + CPL.
  if (googleAdsGclids.length > 0) {
    // Custom range (2026-05-29): passa from/to direto pro helper. Diff implícito no cache.
    const [enrichment, campaignCosts] = await Promise.all([
      enrichGclids(googleAdsGclids),
      getGoogleAdsCampaignCosts({ from: since, to: until }).catch(() => null),
    ])
    const campaignCounts: Record<string, number> = {}
    let unknownCount = 0
    for (const { gclid } of googleAdsGclids) {
      const sanitized = gclid.replace(/\*/g, '_')
      const info = enrichment.get(sanitized)
      if (info && info.campaignName) {
        campaignCounts[info.campaignName] = (campaignCounts[info.campaignName] || 0) + 1
      } else {
        unknownCount++
      }
    }
    // Format: "NomeCampanha (19 leads · R$ 24.288 · R$ 1.278/lead)"
    // Sem custo disponível: "NomeCampanha (19 leads)"
    const fmtBRL = (cents: number) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const topCampaigns = Object.entries(campaignCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, n]) => {
        const costCents = campaignCosts?.get(name)
        if (!costCents || costCents <= 0) return `${name} (${n} leads)`
        const cplCents = Math.round(costCents / n)
        return `${name} (${n} leads · ${fmtBRL(costCents)} · ${fmtBRL(cplCents)}/lead)`
      })
    if (unknownCount > 0) {
      topCampaigns.push(`Sem dado (${unknownCount} leads · custo n/a)`)
    }
    result.topCampaigns = topCampaigns
  }

  return result
}
