/**
 * Google Ads API enrichment — Fase 2 (2026-05-28) + Fix 2.1 (2026-05-28).
 *
 * Pra cada gclid em marketing_whatsapp_redirects, consulta click_view do
 * Google Ads API e retorna { campaignName, adGroupName }.
 *
 * Cache em memória module-scope, TTL 24h. Single-pod (Coolify) suficiente
 * pro nosso volume. Cache perde em restart ERP — aceita-se.
 *
 * IMPORTANTE: click_view requer filtro de UM DIA por query (limitação Google
 * Ads API). Agrupamos gclids por dia BRT e fazemos 1 query/dia (worst case
 * 30 queries pra dashboard 30d; cache 24h amortiza calls subsequentes).
 *
 * IMPORTANTE: click_view só retém 90 dias. gclids mais antigos retornam vazio
 * (não é erro). UI mostra esses como "Sem dado".
 *
 * IMPORTANTE: `login-customer-id` header só vai se for diferente de customer_id
 * (sinaliza acesso via MCC). Pra conta com acesso direto OAuth, omitir o header.
 */

type GclidInfo = {
  campaignName: string | null
  adGroupName: string | null
}

type CacheEntry = {
  info: GclidInfo
  fetchedAt: number
}

export type GclidWithDate = {
  gclid: string
  clickAt: Date
}

const CACHE: Map<string, CacheEntry> = new Map()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

// gclid sanitization (mesmo padrão do cron upload-conversions)
function sanitizeGclid(g: string): string {
  return g.replace(/\*/g, '_')
}

// BRT date string YYYY-MM-DD (Google Ads aceita timezone do customer; BRT=UTC-3)
function toBRTDateStr(d: Date): string {
  const brt = new Date(d.getTime() - 3 * 3600 * 1000)
  const y = brt.getUTCFullYear()
  const m = String(brt.getUTCMonth() + 1).padStart(2, '0')
  const day = String(brt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getCfg() {
  if (!process.env.GOOGLE_ADS_CUSTOMER_ID) return null
  return {
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
  }
}

async function getAccessToken(cfg: ReturnType<typeof getCfg>): Promise<string | null> {
  if (!cfg) return null
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const data = await res.json()
    return data.access_token || null
  } catch {
    return null
  }
}

/**
 * Enriquece batch de (gclid, clickAt) — retorna Map<sanitizedGclid, GclidInfo>.
 * gclids não encontrados em click_view (fora janela 90d, conta inacessível, etc)
 * não aparecem no Map.
 */
export async function enrichGclids(items: GclidWithDate[]): Promise<Map<string, GclidInfo>> {
  const result = new Map<string, GclidInfo>()
  if (items.length === 0) return result

  // 1. Dedup por gclid sanitizado, mantendo MAIS RECENTE clickAt (pra escolher dia da query)
  const bySanitized = new Map<string, Date>()
  for (const it of items) {
    const s = sanitizeGclid(it.gclid)
    const prev = bySanitized.get(s)
    if (!prev || it.clickAt > prev) bySanitized.set(s, it.clickAt)
  }

  // 2. Separar cache hits e misses
  const now = Date.now()
  const misses: { gclid: string; day: string }[] = []
  for (const [gclid, clickAt] of bySanitized) {
    const c = CACHE.get(gclid)
    if (c && now - c.fetchedAt < CACHE_TTL_MS) {
      result.set(gclid, c.info)
    } else {
      misses.push({ gclid, day: toBRTDateStr(clickAt) })
    }
  }

  if (misses.length === 0) return result

  // 3. Buscar misses via Google Ads API
  const cfg = getCfg()
  if (!cfg || !cfg.developerToken || !cfg.refreshToken) return result

  const accessToken = await getAccessToken(cfg)
  if (!accessToken) return result

  // GAQL injection guard: whitelist estrito antes de interpolar em IN list.
  const safe = misses.filter(m => /^[A-Za-z0-9_-]{1,500}$/.test(m.gclid))

  // Agrupar por dia BRT — click_view requer filtro de UM DIA por query.
  const byDay: Map<string, string[]> = new Map()
  for (const m of safe) {
    const arr = byDay.get(m.day) || []
    arr.push(m.gclid)
    byDay.set(m.day, arr)
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
  }
  // login-customer-id só pra acesso via MCC (loginCustomerId !== customerId).
  // Pra acesso direto OAuth (mesma conta), omitir — header causa PERMISSION_DENIED
  // quando customer_id não é cliente do MCC indicado.
  if (cfg.loginCustomerId && cfg.loginCustomerId !== cfg.customerId) {
    headers['login-customer-id'] = cfg.loginCustomerId
  }

  // 1 query por dia. Em cada dia, IN list de gclids (chunks de 500 por segurança).
  const CHUNK = 500
  for (const [day, gclids] of byDay) {
    for (let i = 0; i < gclids.length; i += CHUNK) {
      const batch = gclids.slice(i, i + CHUNK)
      const inList = batch.map(g => `'${g}'`).join(',')
      const query = `
        SELECT
          click_view.gclid,
          campaign.name,
          ad_group.name
        FROM click_view
        WHERE click_view.gclid IN (${inList})
          AND segments.date = '${day}'
      `.trim()

      try {
        const res = await fetch(
          `https://googleads.googleapis.com/v20/customers/${cfg.customerId}/googleAds:searchStream`,
          { method: 'POST', headers, body: JSON.stringify({ query }) },
        )

        if (!res.ok) continue
        const data = await res.json()
        const rows: any[] = []
        if (Array.isArray(data)) {
          for (const chunk of data) {
            if (chunk.results) rows.push(...chunk.results)
          }
        } else if (data.results) {
          rows.push(...data.results)
        }

        const foundGclids = new Set<string>()
        for (const r of rows) {
          const g = r.clickView?.gclid
          if (!g) continue
          const info: GclidInfo = {
            campaignName: r.campaign?.name || null,
            adGroupName: r.adGroup?.name || null,
          }
          CACHE.set(g, { info, fetchedAt: now })
          result.set(g, info)
          foundGclids.add(g)
        }

        // Cache os "not found" também (pra não retentar nas próximas 24h)
        for (const g of batch) {
          if (!foundGclids.has(g)) {
            CACHE.set(g, { info: { campaignName: null, adGroupName: null }, fetchedAt: now })
          }
        }
      } catch {
        continue
      }
    }
  }

  return result
}
