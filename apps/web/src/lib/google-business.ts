import 'server-only'
import { prisma } from '@pontual/db'

/**
 * Wrapper Google Business Profile (GBP) API.
 * Usa OAuth 2.0 com refresh_token salvo em Setting por empresa.
 *
 * Settings relacionadas:
 *   gbp.client_id          (ou env GOOGLE_CLIENT_ID_<COMPANY>)
 *   gbp.client_secret      (ou env GOOGLE_CLIENT_SECRET_<COMPANY>)
 *   gbp.refresh_token      (salvo apos OAuth callback)
 *   gbp.access_token       (cache, renovado via refresh)
 *   gbp.access_expires_at  (epoch ms)
 *   gbp.account_id         (ex: 'accounts/12345')
 *   gbp.location_id        (ex: '67890' ou 'locations/67890')
 */

export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage'

type OAuthCreds = {
  clientId: string
  clientSecret: string
}

function envByCompany(companyId: string, suffix: string): string | null {
  const key = companyId === 'pontualtech-001' ? 'PONTUALTECH' :
    companyId.startsWith('86c829cf') ? 'IMPRIMITECH' : null
  if (!key) return null
  return process.env[`GOOGLE_${suffix}_${key}`] || null
}

async function getCreds(companyId: string): Promise<OAuthCreds | null> {
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { in: ['gbp.client_id', 'gbp.client_secret'] } },
  })
  const m = new Map(settings.map(s => [s.key, s.value]))
  const clientId = m.get('gbp.client_id') || envByCompany(companyId, 'CLIENT_ID') || ''
  const clientSecret = m.get('gbp.client_secret') || envByCompany(companyId, 'CLIENT_SECRET') || ''
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function getRedirectUri(companyId: string): string {
  const base = companyId === 'pontualtech-001'
    ? 'https://portal.pontualtech.com.br'
    : 'https://portal.imprimitech.com.br'
  return `${base}/api/integracoes/google-business/callback`
}

/** URL pro user autorizar. State = companyId pra callback identificar. */
export async function getAuthorizeUrl(companyId: string): Promise<string | null> {
  const creds = await getCreds(companyId)
  if (!creds) return null
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: getRedirectUri(companyId),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: GBP_SCOPE,
    state: companyId,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/** Troca code por tokens + persiste. */
export async function exchangeCode(
  companyId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const creds = await getCreds(companyId)
  if (!creds) return { success: false, error: 'no_creds' }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: getRedirectUri(companyId),
        grant_type: 'authorization_code',
      }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.error_description || data.error || 'token_exchange_failed' }
    const expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000
    await Promise.all([
      upsertSetting(companyId, 'gbp.access_token', data.access_token),
      data.refresh_token ? upsertSetting(companyId, 'gbp.refresh_token', data.refresh_token) : Promise.resolve(),
      upsertSetting(companyId, 'gbp.access_expires_at', String(expiresAt)),
    ])
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Renova access_token via refresh_token se necessario. */
async function getValidAccessToken(companyId: string): Promise<string | null> {
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'gbp.' } },
  })
  const m = new Map(settings.map(s => [s.key, s.value]))
  const accessToken = m.get('gbp.access_token')
  const expiresAt = Number(m.get('gbp.access_expires_at') || 0)
  const refreshToken = m.get('gbp.refresh_token')

  // Token ainda valido (com margem de 5min)
  if (accessToken && expiresAt > Date.now() + 5 * 60 * 1000) return accessToken

  if (!refreshToken) return null
  const creds = await getCreds(companyId)
  if (!creds) return null

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('[GBP] refresh falhou:', data)
      return null
    }
    const newExpires = Date.now() + (Number(data.expires_in) || 3600) * 1000
    await Promise.all([
      upsertSetting(companyId, 'gbp.access_token', data.access_token),
      upsertSetting(companyId, 'gbp.access_expires_at', String(newExpires)),
    ])
    return data.access_token
  } catch (err) {
    console.error('[GBP] refresh exception:', err)
    return null
  }
}

async function upsertSetting(companyId: string, key: string, value: string) {
  await prisma.setting.upsert({
    where: { company_id_key: { company_id: companyId, key } },
    create: { company_id: companyId, key, value, type: 'string' },
    update: { value, updated_at: new Date() },
  })
}

export type GBPReview = {
  name: string            // reviews/{id}
  reviewId: string
  reviewer: { displayName: string; profilePhotoUrl?: string }
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE' | string
  starNumber: number
  comment: string
  createTime: string
  updateTime: string
  reviewReply?: { comment: string; updateTime: string }
}

const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }

/** Lista reviews do GBP da empresa. */
export async function listReviews(companyId: string): Promise<{
  success: boolean; reviews?: GBPReview[]; error?: string
}> {
  const token = await getValidAccessToken(companyId)
  if (!token) return { success: false, error: 'no_token — conecte via OAuth primeiro' }

  const locSetting = await prisma.setting.findFirst({
    where: { company_id: companyId, key: 'gbp.location_id' },
  })
  const accountSetting = await prisma.setting.findFirst({
    where: { company_id: companyId, key: 'gbp.account_id' },
  })
  const locationId = locSetting?.value
  const accountId = accountSetting?.value
  if (!locationId || !accountId) {
    return { success: false, error: 'gbp.account_id ou gbp.location_id nao configurado' }
  }

  // Normaliza prefixo — aceita 'accounts/123' ou '123'
  const accountPath = accountId.startsWith('accounts/') ? accountId : `accounts/${accountId}`
  const locPath = locationId.startsWith('locations/') ? locationId : `locations/${locationId}`

  try {
    const url = `https://mybusiness.googleapis.com/v4/${accountPath}/${locPath}/reviews`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (!res.ok) {
      return { success: false, error: data.error?.message || `HTTP ${res.status}` }
    }
    const reviews: GBPReview[] = (data.reviews || []).map((r: any) => ({
      name: r.name,
      reviewId: r.reviewId || r.name?.split('/').pop() || '',
      reviewer: {
        displayName: r.reviewer?.displayName || 'Cliente',
        profilePhotoUrl: r.reviewer?.profilePhotoUrl,
      },
      starRating: r.starRating,
      starNumber: STAR_MAP[r.starRating] || 0,
      comment: r.comment || '',
      createTime: r.createTime,
      updateTime: r.updateTime,
      reviewReply: r.reviewReply,
    }))
    return { success: true, reviews }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Responde um review como o dono. */
export async function replyReview(
  companyId: string,
  reviewName: string,
  comment: string,
): Promise<{ success: boolean; error?: string }> {
  const token = await getValidAccessToken(companyId)
  if (!token) return { success: false, error: 'no_token' }
  try {
    const res = await fetch(`https://mybusiness.googleapis.com/v4/${reviewName}/reply`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment }),
    })
    const data = await res.json()
    if (!res.ok) return { success: false, error: data.error?.message || `HTTP ${res.status}` }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
