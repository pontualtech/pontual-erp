/**
 * Google Ads API enrichment — Fase 2 (2026-05-28).
 *
 * Pra cada gclid em marketing_whatsapp_redirects, consulta click_view do
 * Google Ads API e retorna { campaignName, adGroupName }.
 *
 * Cache em memória module-scope, TTL 24h. Single-pod (Coolify) suficiente
 * pro nosso volume. Cache perde em restart ERP — aceita-se.
 *
 * Quota: ~50 cliques/dia × cache 24h = ~50 req/dia (0.3% da quota Basic 15k).
 *
 * IMPORTANTE: click_view só retém 90 dias. gclids mais antigos retornam vazio
 * (não é erro). UI mostra esses como "Sem dado".
 */

type GclidInfo = {
  campaignName: string | null
  adGroupName: string | null
}

type CacheEntry = {
  info: GclidInfo
  fetchedAt: number
}

const CACHE: Map<string, CacheEntry> = new Map()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

// gclid sanitization (mesmo padrão do cron upload-conversions)
function sanitizeGclid(g: string): string {
  return g.replace(/\*/g, '_')
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
 * Enriquece batch de gclids — retorna Map<sanitizedGclid, GclidInfo>.
 * gclids não encontrados em click_view (fora janela 90d) não aparecem no Map.
 */
export async function enrichGclids(rawGclids: string[]): Promise<Map<string, GclidInfo>> {
  const result = new Map<string, GclidInfo>()
  if (rawGclids.length === 0) return result

  // 1. Dedup + sanitize
  const sanitized = Array.from(new Set(rawGclids.map(sanitizeGclid)))

  // 2. Separar cache hits e misses
  const now = Date.now()
  const misses: string[] = []
  for (const g of sanitized) {
    const c = CACHE.get(g)
    if (c && now - c.fetchedAt < CACHE_TTL_MS) {
      result.set(g, c.info)
    } else {
      misses.push(g)
    }
  }

  if (misses.length === 0) return result

  // 3. Buscar misses via Google Ads API
  const cfg = getCfg()
  if (!cfg || !cfg.developerToken || !cfg.refreshToken) return result // sem creds → return só cache

  const accessToken = await getAccessToken(cfg)
  if (!accessToken) return result

  // GAQL injection guard: whitelist estrito antes de interpolar em IN list.
  // gclids reais matcham [A-Za-z0-9_-]+ (já passaram por sanitizeGclid: *→_).
  // Defense in depth caso DB tenha sido envenenado via UTM injection.
  const safe = misses.filter(g => /^[A-Za-z0-9_-]{1,500}$/.test(g))

  // Batch query — Google Ads SQL aceita IN com até ~10k items, mas vamos chunk em 500 por segurança
  const CHUNK = 500
  for (let i = 0; i < safe.length; i += CHUNK) {
    const batch = safe.slice(i, i + CHUNK)
    const inList = batch.map(g => `'${g}'`).join(',')
    const query = `
      SELECT
        click_view.gclid,
        campaign.name,
        ad_group.name
      FROM click_view
      WHERE click_view.gclid IN (${inList})
        AND segments.date DURING LAST_90_DAYS
    `.trim()

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': cfg.developerToken,
        'Content-Type': 'application/json',
      }
      if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId

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
      // Falha silenciosa — dashboard funciona sem enrichment
      continue
    }
  }

  return result
}
