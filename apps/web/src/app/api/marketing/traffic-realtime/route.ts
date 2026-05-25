import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import {
  getEventChannelBreakdown,
  getActiveNow,
  eventIsConfigured,
  type ChannelBreakdown,
} from '@/lib/ga4-data-api'

const SITES: { site: string; propertyId: string }[] = [
  { site: 'pontualtech.com.br', propertyId: '528407798' },
  { site: 'rcimpressoras.com', propertyId: '535454417' },
  { site: 'sosimpressora.com', propertyId: '535462563' },
  { site: 'pontualtech.net', propertyId: '535465683' },
]

const LEAD_EVENT = 'whatsapp_click'

const CACHE_TTL_MS = 30_000
let cache: { at: number; payload: any } | null = null

type SiteTraffic = {
  site: string
  propertyId: string
  configured: boolean // se whatsapp_click tag está disparando
  today: ChannelBreakdown
  yesterday: ChannelBreakdown
  last7d: ChannelBreakdown
  last30d: ChannelBreakdown
  activeNow: number
  error?: string
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
          const configured = await eventIsConfigured(propertyId, LEAD_EVENT)
          if (!configured) {
            return {
              site, propertyId, configured: false,
              today: emptyBreakdown(),
              yesterday: emptyBreakdown(),
              last7d: emptyBreakdown(),
              last30d: emptyBreakdown(),
              activeNow: await getActiveNow(propertyId).catch(() => 0),
            }
          }
          const [today, yesterday, last7d, last30d, activeNow] = await Promise.all([
            getEventChannelBreakdown(propertyId, { startDate: 'today', endDate: 'today' }, LEAD_EVENT),
            getEventChannelBreakdown(propertyId, { startDate: 'yesterday', endDate: 'yesterday' }, LEAD_EVENT),
            getEventChannelBreakdown(propertyId, { startDate: '7daysAgo', endDate: 'today' }, LEAD_EVENT),
            getEventChannelBreakdown(propertyId, { startDate: '30daysAgo', endDate: 'today' }, LEAD_EVENT),
            getActiveNow(propertyId),
          ])
          return { site, propertyId, configured: true, today, yesterday, last7d, last30d, activeNow }
        } catch (e) {
          return {
            site, propertyId, configured: false,
            today: emptyBreakdown(),
            yesterday: emptyBreakdown(),
            last7d: emptyBreakdown(),
            last30d: emptyBreakdown(),
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

function emptyBreakdown(): ChannelBreakdown {
  return {
    google_ads: 0, microsoft_ads: 0, meta_ads: 0, linkedin_ads: 0, x_ads: 0, tiktok_ads: 0,
    organic: 0, direct: 0, email: 0, referral: 0, social: 0, other: 0, total: 0,
  }
}
