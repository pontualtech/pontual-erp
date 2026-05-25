/**
 * GA4 Data API helper — Service Account JWT auth.
 *
 * Reads service account JSON from env `GOOGLE_SA_JSON` (production)
 * or from `.google_service_account.local.json` in repo root (dev fallback).
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

type ServiceAccount = {
  client_email: string
  private_key: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function loadServiceAccount(): ServiceAccount {
  const env = process.env.GOOGLE_SA_JSON
  if (env) return JSON.parse(env)
  // Dev fallback
  const localPath = path.resolve(process.cwd(), '../../..', '.google_service_account.local.json')
  if (fs.existsSync(localPath)) return JSON.parse(fs.readFileSync(localPath, 'utf8'))
  throw new Error('GA4_SA_NOT_CONFIGURED: set GOOGLE_SA_JSON env var or .google_service_account.local.json at repo root')
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token

  const sa = loadServiceAccount()
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signInput = `${header}.${payload}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signInput), sa.private_key).toString('base64url')
  const jwt = `${signInput}.${signature}`

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }).toString()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`GA4_TOKEN_EXCHANGE_FAILED: ${res.status} ${await res.text()}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in }
  return data.access_token
}

export type ChannelBreakdown = {
  google_ads: number
  microsoft_ads: number
  meta_ads: number      // FB + Insta (paid) — 2026-05-25
  linkedin_ads: number  // 2026-05-25
  x_ads: number         // X/Twitter — 2026-05-25
  tiktok_ads: number    // 2026-05-25
  organic: number
  direct: number
  email: number
  referral: number
  social: number        // social orgânico (sem paid)
  other: number
  total: number
}

/**
 * Classify a GA4 source/medium string into our marketing buckets.
 *
 * Karlão: define como cada bucket é detectado abaixo.
 * Trade-offs:
 *  - "(direct) / (none)" e "(not set)" geralmente são entradas diretas + bots
 *  - Bing/MS Ads usa medium=cpc com source=bing
 *  - Email tipicamente vem com medium=email (utm_medium=email das campanhas Mautic)
 *  - Social: facebook|instagram|linkedin etc com medium=social ou referral
 */
export function classifyChannel(sourceMedium: string): keyof Omit<ChannelBreakdown, 'total'> {
  const sm = sourceMedium.toLowerCase()
  // Paid — verificar ANTES de social orgânico
  if (/google\s*\/\s*cpc/.test(sm) || /google\s*\/\s*paid/.test(sm)) return 'google_ads'
  if (/bing\s*\/\s*cpc/.test(sm) || /microsoft\s*\/\s*cpc/.test(sm)) return 'microsoft_ads'
  // Meta (FB/Insta) — paid_social ou cpc com source meta/facebook/instagram
  if (/(facebook|instagram|meta|fb)\s*\/\s*(cpc|paid_social|paid)/.test(sm)) return 'meta_ads'
  if (/linkedin\s*\/\s*(cpc|paid_social|paid)/.test(sm)) return 'linkedin_ads'
  if (/(twitter|^x)\s*\/\s*(cpc|paid_social|paid)/.test(sm)) return 'x_ads'
  if (/tiktok\s*\/\s*(cpc|paid_social|paid)/.test(sm)) return 'tiktok_ads'
  // Orgânico
  if (/\/\s*organic\b/.test(sm)) return 'organic'
  // Email
  if (/\/\s*email\b/.test(sm) || /mautic/.test(sm)) return 'email'
  // Social orgânico (sem paid)
  if (/(facebook|instagram|linkedin|twitter|tiktok|youtube)/.test(sm)) return 'social'
  // Direto
  if (sm.startsWith('(direct)') || sm.includes('(not set)') || sm.includes('(data not available)')) {
    return 'direct'
  }
  // Referral
  if (/\/\s*referral\b/.test(sm)) return 'referral'
  return 'other'
}

export async function runReport(propertyId: string, body: object): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GA4_RUNREPORT_FAILED: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function runRealtimeReport(propertyId: string, body: object): Promise<any> {
  const token = await getAccessToken()
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`GA4_REALTIME_FAILED: ${res.status} ${await res.text()}`)
  return res.json()
}

/**
 * Returns channel breakdown of an EVENT (e.g. whatsapp_click, phone_click) for a property.
 *
 * Karlão: usamos o COUNT de event como métrica de canal (não sessions),
 * porque o clique no botão WhatsApp é o LEAD efetivo (intent confirmado),
 * não a mera visita à página.
 */
export async function getEventChannelBreakdown(
  propertyId: string,
  dateRange: { startDate: string; endDate: string },
  eventName: string,
): Promise<ChannelBreakdown> {
  const data = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: 'sessionSourceMedium' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', stringFilter: { value: eventName } },
    },
    limit: 200,
  })
  const result: ChannelBreakdown = {
    google_ads: 0, microsoft_ads: 0, meta_ads: 0, linkedin_ads: 0, x_ads: 0, tiktok_ads: 0,
    organic: 0, direct: 0, email: 0, referral: 0, social: 0, other: 0, total: 0,
  }
  for (const row of data.rows || []) {
    const sourceMedium = row.dimensionValues[0].value
    const events = Number(row.metricValues[0].value || 0)
    const bucket = classifyChannel(sourceMedium)
    result[bucket] += events
    result.total += events
  }
  return result
}

/**
 * Returns session-based channel breakdown (legacy — total visits, not leads).
 * Kept for fallback when an event isn't configured.
 */
export async function getChannelBreakdown(propertyId: string, dateRange: { startDate: string; endDate: string }): Promise<ChannelBreakdown> {
  const data = await runReport(propertyId, {
    dateRanges: [dateRange],
    dimensions: [{ name: 'sessionSourceMedium' }],
    metrics: [{ name: 'sessions' }],
    limit: 200,
  })
  const result: ChannelBreakdown = {
    google_ads: 0, microsoft_ads: 0, meta_ads: 0, linkedin_ads: 0, x_ads: 0, tiktok_ads: 0,
    organic: 0, direct: 0, email: 0, referral: 0, social: 0, other: 0, total: 0,
  }
  for (const row of data.rows || []) {
    const sourceMedium = row.dimensionValues[0].value
    const sessions = Number(row.metricValues[0].value || 0)
    const bucket = classifyChannel(sourceMedium)
    result[bucket] += sessions
    result.total += sessions
  }
  return result
}

/**
 * Checks whether a given event has been registered in the property recently.
 * Used to detect sites where whatsapp_click tag isn't configured yet.
 */
export async function eventIsConfigured(propertyId: string, eventName: string): Promise<boolean> {
  const data = await runReport(propertyId, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: eventName } } },
    limit: 1,
  })
  return Boolean(data.rows && data.rows.length > 0)
}

/**
 * Returns active users in last 30 min (real-time).
 */
export async function getActiveNow(propertyId: string): Promise<number> {
  const data = await runRealtimeReport(propertyId, {
    metrics: [{ name: 'activeUsers' }],
  })
  if (!data.rows || data.rows.length === 0) return 0
  return Number(data.rows[0].metricValues[0].value || 0)
}
