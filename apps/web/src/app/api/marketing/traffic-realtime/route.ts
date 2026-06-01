import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import {
  getEventChannelBreakdown,
  getActiveNow,
  eventIsConfigured,
  type ChannelBreakdown,
} from '@/lib/ga4-data-api'
import { getCWTChannelBreakdown, type CWTBreakdown } from '@/lib/cwt-channel-breakdown'

const SITES: { site: string; propertyId: string }[] = [
  { site: 'pontualtech.com.br', propertyId: '528407798' },
  { site: 'rcimpressoras.com', propertyId: '535454417' },
  { site: 'sosimpressora.com', propertyId: '535462563' },
  { site: 'pontualtech.net', propertyId: '535465683' },
]

const LEAD_EVENT = 'whatsapp_click'

const CACHE_TTL_MS = 30_000
let cache: { at: number; payload: any } | null = null

// CWT-first 2026-05-28: cada janela usa CWT primeiro; se total === 0, fallback GA4.
// source indica origem do número exibido pro user.
type WindowBreakdown = CWTBreakdown & { source: 'cwt' | 'ga4_fallback' }

type SiteTraffic = {
  site: string
  propertyId: string
  configured: boolean // se whatsapp_click tag está disparando no GA4 (ainda útil pra fallback)
  today: WindowBreakdown
  yesterday: WindowBreakdown
  last7d: WindowBreakdown
  last30d: WindowBreakdown
  activeNow: number
  error?: string
}

/**
 * CWT-first: tenta CWT; se vazio (total === 0), fallback pra GA4.
 * Active users continua sempre via GA4 (realtime API, CWT não tem).
 */
async function getWindowBreakdown(
  hostname: string,
  propertyId: string,
  dateRange: { startDate: string; endDate: string },
  configured: boolean,
): Promise<WindowBreakdown> {
  // 1. Try CWT primeiro
  let cwt: CWTBreakdown | null = null
  try {
    cwt = await getCWTChannelBreakdown(hostname, dateRange)
  } catch (e) {
    console.error(`[traffic-realtime] CWT falhou (${hostname} ${dateRange.startDate}..${dateRange.endDate}):`, e instanceof Error ? e.message : e)
  }
  if (cwt && cwt.total > 0) {
    return { ...cwt, source: 'cwt' }
  }
  // 2. Fallback GA4 (se configurado)
  if (configured) {
    try {
      const ga4 = await getEventChannelBreakdown(propertyId, dateRange, LEAD_EVENT)
      if (ga4) {
        return { ...ga4, topKeywords: [], topCampaigns: [], source: 'ga4_fallback' }
      }
    } catch (e) {
      console.error(`[traffic-realtime] GA4 fallback falhou (${hostname} property=${propertyId}):`, e instanceof Error ? e.message : e)
    }
  }
  // 3. Nenhum dado
  return { ...emptyBreakdown(), source: 'cwt' }
}

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result

    const now = Date.now()
    if (cache && now - cache.at < CACHE_TTL_MS) {
      return success({ ...cache.payload, cached: true })
    }

    const sites: SiteTraffic[] = await Promise.all(
      SITES.map(async ({ site, propertyId }) => {
        try {
          // Audit 30/05 + bug-hunt 01/06: separar "GA4 confirma 0 events" (configured=false legítimo)
          // de "infra falhou" (auth, rede, propriedade). Bug anterior: `.catch(() => false)`
          // misturava os dois → UI mostrava "tag não configurada" quando GOOGLE_SA_JSON ausente.
          let configured = false
          let ga4Error: string | undefined
          try {
            configured = await eventIsConfigured(propertyId, LEAD_EVENT)
          } catch (e) {
            ga4Error = e instanceof Error ? e.message : String(e)
            console.error(`[traffic-realtime] eventIsConfigured falhou (${site} property=${propertyId}):`, ga4Error)
          }
          const [today, yesterday, last7d, last30d, activeNow] = await Promise.all([
            getWindowBreakdown(site, propertyId, { startDate: 'today', endDate: 'today' }, configured),
            getWindowBreakdown(site, propertyId, { startDate: 'yesterday', endDate: 'yesterday' }, configured),
            getWindowBreakdown(site, propertyId, { startDate: '7daysAgo', endDate: 'today' }, configured),
            getWindowBreakdown(site, propertyId, { startDate: '30daysAgo', endDate: 'today' }, configured),
            getActiveNow(propertyId).catch((e) => {
              console.error(`[traffic-realtime] getActiveNow falhou (${site}):`, e instanceof Error ? e.message : e)
              return 0
            }),
          ])
          return { site, propertyId, configured, today, yesterday, last7d, last30d, activeNow, error: ga4Error }
        } catch (e) {
          return {
            site, propertyId, configured: false,
            today: { ...emptyBreakdown(), source: 'cwt' as const },
            yesterday: { ...emptyBreakdown(), source: 'cwt' as const },
            last7d: { ...emptyBreakdown(), source: 'cwt' as const },
            last30d: { ...emptyBreakdown(), source: 'cwt' as const },
            activeNow: 0,
            error: e instanceof Error ? e.message : String(e),
          }
        }
      })
    )

    const payload = {
      generatedAt: new Date().toISOString(),
      leadEvent: LEAD_EVENT,
      sites,
    }
    cache = { at: now, payload }
    return success({ ...payload, cached: false })
  } catch (e) {
    return handleError(e)
  }
}

function emptyBreakdown(): CWTBreakdown {
  return {
    google_ads: 0, microsoft_ads: 0, meta_ads: 0, linkedin_ads: 0, x_ads: 0, tiktok_ads: 0,
    organic: 0, direct: 0, email: 0, referral: 0, social: 0, other: 0, total: 0,
    topKeywords: [],
    topCampaigns: [],
  }
}
