/**
 * GET /api/cron/upload-conversions
 *
 * Cron diário (chamado por n8n/crontab a cada 6h ou 24h) que envia conversões
 * offline pro Google Ads e Microsoft Ads. Fecha o loop "clique no anúncio →
 * venda real" pros algoritmos de bid otimizarem.
 *
 * Eventos enviados (decisão Karlão 2026-05-21):
 *   - LEAD (OS criada): valor estimado, conversion_action GOOGLE_ADS_LEAD_ACTION_ID
 *   - APPROVED (orçamento aprovado): valor real (quote_total_amount), action GOOGLE_ADS_APPROVED_ACTION_ID
 *
 * Idempotência: marca custom_data.conversion_uploaded.{event}_at após cada upload.
 * Cron pode rodar 2x sem duplicar.
 *
 * Fonte do gclid/msclkid:
 *   1. custom_data.tracking.gclid (Fase 0 — vindo do formulário)
 *   2. botConversation.data.attribution.gclid (Fase 2 CWT — vindo do WhatsApp)
 *   Ambos podem coexistir; tracking de OS tem precedência.
 *
 * Auth: header Authorization: Bearer ${CRON_SECRET}
 */

import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// ---------------------------------------------------------------------------
// Config (env-driven)
// ---------------------------------------------------------------------------

interface GoogleAdsConfig {
  customerId: string         // ex: '2870010341' (sem hífens)
  developerToken: string     // do Google Ads API console
  loginCustomerId?: string   // MCC manager account (se aplicável)
  refreshToken: string       // OAuth2 refresh token
  clientId: string           // OAuth2 client ID
  clientSecret: string       // OAuth2 client secret
  conversionActionLead: string     // resource name: customers/X/conversionActions/Y
  conversionActionApproved: string
  conversionActionWhatsapp: string // clique WhatsApp (CWT server-side), imune a consent
}

interface BingAdsConfig {
  customerId: string
  customerAccountId: string
  developerToken: string
  refreshToken: string
  clientId: string
  // Bing offline conversion goal name (string id no Bing UI)
  goalLead: string
  goalApproved: string
}

const PT_GOOGLE_ADS: GoogleAdsConfig | null = process.env.GOOGLE_ADS_CUSTOMER_ID ? {
  customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
  developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
  loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
  clientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
  conversionActionLead: process.env.GOOGLE_ADS_CONV_ACTION_LEAD || '',
  conversionActionApproved: process.env.GOOGLE_ADS_CONV_ACTION_APPROVED || '',
  conversionActionWhatsapp: process.env.GOOGLE_ADS_CONV_ACTION_WHATSAPP || '',
} : null

const PT_BING_ADS: BingAdsConfig | null = process.env.BING_ADS_CUSTOMER_ID ? {
  customerId: process.env.BING_ADS_CUSTOMER_ID,
  customerAccountId: process.env.BING_ADS_CUSTOMER_ACCOUNT_ID || '',
  developerToken: process.env.BING_ADS_DEVELOPER_TOKEN || '',
  refreshToken: process.env.BING_ADS_REFRESH_TOKEN || '',
  clientId: process.env.BING_ADS_CLIENT_ID || '',
  goalLead: process.env.BING_ADS_GOAL_LEAD || '',
  goalApproved: process.env.BING_ADS_GOAL_APPROVED || '',
} : null

// ---------------------------------------------------------------------------
// Business logic: valor da conversão LEAD (OS recém criada, valor incerto)
// ---------------------------------------------------------------------------

/**
 * Quanto vale uma OS recém criada (lead) pro Google Ads aprender?
 *
 * Trade-offs:
 *   - Valor MÉDIO histórico (ex: R$ 250): algoritmo otimiza por volume, mas
 *     gasta budget em leads que talvez não fechem (false positives caros).
 *   - Valor FIXO BAIXO (ex: R$ 50): conservador, mas algoritmo subvaloriza
 *     keywords boas — pode reduzir bids em queries valiosas.
 *   - Valor por TIPO DE EQUIPAMENTO: laser vale mais que jato, etc. Mais
 *     preciso mas requer manutenção da tabela.
 *
 * TODO Karlão: implementar a regra de negócio aqui. Recebe a OS completa
 * e retorna o valor em R$ (number) que será enviado pro Google Ads como
 * conversion_value do evento LEAD.
 *
 * Exemplos:
 *   - return 100  // valor fixo baixo
 *   - return os.equipment_type === 'Impressora Laser' ? 300 : 150  // por tipo
 *   - return await getAvgPaidValue(companyId)  // média histórica dinâmica
 */
function valueForLead(os: any): number {
  // TODO: Karlão implementa aqui — ver opções acima
  return 100 // valor fixo placeholder; mude pra refletir realidade do negócio
}

// ---------------------------------------------------------------------------
// Attribution recovery helpers
// ---------------------------------------------------------------------------

interface Attribution {
  gclid?: string
  msclkid?: string
  utm_source?: string
  utm_campaign?: string
  utm_term?: string
  source: 'os.custom_data' | 'bot.attribution' | 'none'
}

async function recoverAttribution(os: any, customer: any): Promise<Attribution> {
  const cd = os.custom_data as Record<string, any> | null
  const tracking = cd && typeof cd === 'object' ? cd.tracking as Record<string, string> | undefined : undefined
  if (tracking?.gclid || tracking?.msclkid) {
    return {
      gclid: tracking.gclid,
      msclkid: tracking.msclkid,
      utm_source: tracking.utm_source,
      utm_campaign: tracking.utm_campaign,
      utm_term: tracking.utm_term,
      source: 'os.custom_data',
    }
  }
  // Fallback: buscar botConversation pelo telefone do cliente
  const phone = (customer?.mobile || customer?.phone || '').replace(/\D/g, '')
  if (phone.length >= 10) {
    const conv = await prisma.botConversation.findFirst({
      where: { company_id: os.company_id, customer_phone: { endsWith: phone.slice(-10) } },
      orderBy: { created_at: 'desc' },
    })
    const attr = conv?.data && typeof conv.data === 'object' && !Array.isArray(conv.data)
      ? ((conv.data as Record<string, any>).attribution as Record<string, string> | undefined)
      : undefined
    if (attr?.gclid || attr?.msclkid) {
      return {
        gclid: attr.gclid,
        msclkid: attr.msclkid,
        utm_source: attr.src,
        utm_campaign: attr.camp,
        utm_term: attr.kw,
        source: 'bot.attribution',
      }
    }
  }
  return { source: 'none' }
}

// ---------------------------------------------------------------------------
// Google Ads Click Conversion Import API
// ---------------------------------------------------------------------------

/**
 * Refresh OAuth2 access_token. Chamar UMA VEZ por cron run e reusar
 * (token vale 3600s). 2026-05-28: detectado que múltiplos refreshes em sequência
 * causavam 401 esporádico (provável rate limit não-documentado do OAuth server).
 */
async function getGoogleAdsAccessToken(cfg: GoogleAdsConfig): Promise<string | null> {
  if (!cfg.developerToken || !cfg.refreshToken || !cfg.clientId) return null
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    return tokenData.access_token || null
  } catch {
    return null
  }
}

async function uploadGoogleAdsConversion(
  cfg: GoogleAdsConfig,
  accessToken: string | null,
  gclid: string,
  conversionActionResource: string,
  value: number,
  conversionDateTime: Date,
): Promise<{ ok: boolean; error?: string }> {
  if (!cfg.developerToken || !accessToken || !conversionActionResource) {
    return { ok: false, error: 'Google Ads credentials not configured (skipping upload, would have sent gclid=' + gclid.slice(0, 12) + '...)' }
  }
  // Workaround: alguma etapa upstream (site/n8n/Dify) escapa "_" como "*" no gclid antes
  // de gravar em custom_data.tracking.gclid. Google rejeita gclids com "*" ("could not be
  // decoded"). Revertemos aqui — "*" não é caractere válido em gclid Google (alfanum+-_),
  // então a substituição é segura. TODO: achar root cause da substituição upstream.
  const sanitizedGclid = gclid.replace(/\*/g, '_')
  try {
    const url = `https://googleads.googleapis.com/v20/customers/${cfg.customerId}:uploadClickConversions`
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': cfg.developerToken,
      'Content-Type': 'application/json',
    }
    if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId
    const body = {
      conversions: [{
        gclid: sanitizedGclid,
        conversionAction: conversionActionResource,
        conversionDateTime: conversionDateTime.toISOString().replace('T', ' ').replace(/\..+$/, '+00:00'),
        conversionValue: value,
        currencyCode: 'BRL',
      }],
      partialFailure: true,
    }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok || data.partialFailureError) {
      return { ok: false, error: `Google Ads API ${res.status}: ${JSON.stringify(data).slice(0, 300)}` }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: 'Network error: ' + (e?.message || 'unknown') }
  }
}

// ---------------------------------------------------------------------------
// CWT WhatsApp clicks → Google Ads (conversão de contato imune a consent)
// ---------------------------------------------------------------------------

const PT_CWT_COMPANY_ID = 'pontualtech-001'

/**
 * Sobe cliques de WhatsApp capturados server-side (marketing_whatsapp_redirects)
 * como conversão pro Google Ads. Restaura o sinal que a conversão client-side
 * (tipo WEBPAGE) perdeu desde 01/05 — Consent Mode passou a bloquear ad_storage,
 * então o clique só virava conversão se o usuário aceitasse cookies. O CWT grava
 * o clique+gclid no servidor, sem depender de consentimento.
 *
 * Idempotência: marca gads_conversion_uploaded_at após enviar (não reenvia).
 * Janela de 30d é segura porque a coluna impede duplicação mesmo com sobreposição.
 * Dedupe por gclid: 1 conversão de contato por clique de anúncio único.
 * Valor 0 (contagem pura) — categoria CONTACT; valor por lead pode ser ligado depois.
 */
async function uploadCwtWhatsappConversions(
  cfg: GoogleAdsConfig,
  accessToken: string | null,
): Promise<{ sent: number; skipped: number; failed: number; errors: string[] }> {
  const errors: string[] = []
  if (!cfg.conversionActionWhatsapp) {
    return { sent: 0, skipped: 0, failed: 0, errors: ['GOOGLE_ADS_CONV_ACTION_WHATSAPP not configured'] }
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30d; coluna de idempotência impede duplicar
  const rows = await prisma.marketingWhatsappRedirect.findMany({
    where: {
      company_id: PT_CWT_COMPANY_ID,
      gclid: { not: null },               // gclid e gads_*_at são nullable → filtro válido
      gads_conversion_uploaded_at: null,
      click_at: { gte: since },
    },
    select: { id: true, gclid: true, click_at: true },
    orderBy: { click_at: 'asc' },
    take: 500,
  })

  // Dedupe por gclid sanitizado (* → _, mesmo workaround do upload de OS). Junta ids p/ marcar
  // todas as linhas do mesmo gclid. Valida formato: gclid real do Google é base64url com ≥40
  // chars — descarta IDs de teste/sintéticos (ex: 'diag_test_...', 'F2_EVENT_ID_TEST') que
  // poluiriam o algoritmo e seriam rejeitados pela API.
  const byGclid = new Map<string, { clickAt: Date; ids: string[] }>()
  for (const r of rows) {
    const g = (r.gclid || '').replace(/\*/g, '_')
    if (g.length < 40 || !/^[A-Za-z0-9_-]+$/.test(g) || /test|audit|diag|playwright|event_id/i.test(g)) continue
    const e = byGclid.get(g)
    if (e) { e.ids.push(r.id); if (r.click_at > e.clickAt) e.clickAt = r.click_at }
    else byGclid.set(g, { clickAt: r.click_at, ids: [r.id] })
  }

  let sent = 0, failed = 0
  for (const [gclid, { clickAt, ids }] of byGclid) {
    const r = await uploadGoogleAdsConversion(cfg, accessToken, gclid, cfg.conversionActionWhatsapp, 0, clickAt)
    if (r.ok) {
      sent++
      await prisma.marketingWhatsappRedirect.updateMany({
        where: { id: { in: ids } },
        data: { gads_conversion_uploaded_at: new Date() },
      })
    } else {
      failed++
      if (errors.length < 10) errors.push(`gclid ${gclid.slice(0, 12)}…: ${r.error}`)
    }
  }
  const skipped = rows.length - [...byGclid.values()].reduce((n, e) => n + e.ids.length, 0)
  return { sent, skipped, failed, errors }
}

// ---------------------------------------------------------------------------
// Main cron handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[Cron/UploadConv] CRON_SECRET not configured')
    return error('Cron not configured', 503)
  }
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${cronSecret}`
  if (!authHeader || authHeader.length !== expected.length
    || !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
    return error('Unauthorized', 401)
  }

  const now = new Date()
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000) // últimas 36h (margem vs 24h)

  // Eco audit J (2026-05-29): filtrar por company_id PT-001 explicitamente.
  // Antes: findMany sem company_id → pegava OS de TODOS tenants (incluindo
  // Imprimitech). Se IMP customer tinha gclid (raro mas possível), upload
  // ocorria como conversão PT (cross-tenant leak) + escrita em os.custom_data
  // de OS que não é nossa. Multi-tenant violation.
  const PT_COMPANY_ID = process.env.BOT_ANA_COMPANY_ID || 'pontualtech-001'

  // Candidatos: OS criadas no período + OS com quotes aprovadas no período
  const osCreatedRecent = await prisma.serviceOrder.findMany({
    where: { company_id: PT_COMPANY_ID, created_at: { gte: since }, deleted_at: null },
    include: { customers: true },
    take: 500,
  })
  const quotesApprovedRecent = await prisma.quote.findMany({
    where: { company_id: PT_COMPANY_ID, approved_at: { gte: since }, status: { not: 'DRAFT' } },
    include: { service_orders: { include: { customers: true } } },
    take: 500,
  })

  // Index por os.id pra evitar processar 2x quando criada+aprovada na mesma janela
  const byId = new Map<string, { os: any; needLead: boolean; needApproved: boolean; quote?: any }>()
  for (const os of osCreatedRecent) {
    byId.set(os.id, { os, needLead: true, needApproved: false })
  }
  for (const q of quotesApprovedRecent) {
    const os = q.service_orders
    if (!os || os.deleted_at) continue
    const entry = byId.get(os.id)
    if (entry) { entry.needApproved = true; entry.quote = q }
    else byId.set(os.id, { os, needLead: false, needApproved: true, quote: q })
  }

  let leadsSent = 0, leadsSkipped = 0, leadsFailed = 0
  let approvedSent = 0, approvedSkipped = 0, approvedFailed = 0
  const errors: string[] = []

  // OAuth refresh UMA VEZ por cron run (fix 2026-05-28: múltiplos refreshes
  // em sequência causavam 401 esporádico). access_token válido 3600s.
  const googleAccessToken = PT_GOOGLE_ADS ? await getGoogleAdsAccessToken(PT_GOOGLE_ADS) : null

  for (const entry of byId.values()) {
    const { os, quote } = entry
    const cd = (os.custom_data as Record<string, any> | null) || {}
    const uploaded = (cd.conversion_uploaded as Record<string, string> | undefined) || {}
    const needLead = entry.needLead && !uploaded.lead_at
    const needApproved = entry.needApproved && !uploaded.approved_at
    if (!needLead && !needApproved) continue

    const attribution = await recoverAttribution(os, os.customers)
    if (attribution.source === 'none' || (!attribution.gclid && !attribution.msclkid)) {
      if (needLead) leadsSkipped++
      if (needApproved) approvedSkipped++
      continue
    }

    const newUploaded = { ...uploaded }
    let mutated = false

    if (needLead && attribution.gclid && PT_GOOGLE_ADS) {
      const value = valueForLead(os)
      const r = await uploadGoogleAdsConversion(
        PT_GOOGLE_ADS,
        googleAccessToken,
        attribution.gclid,
        PT_GOOGLE_ADS.conversionActionLead,
        value,
        os.created_at,
      )
      if (r.ok) { leadsSent++; newUploaded.lead_at = now.toISOString(); newUploaded.lead_value = String(value); mutated = true }
      else { leadsFailed++; errors.push(`OS #${os.os_number} LEAD: ${r.error}`) }
    }

    const approvedValue = quote?.total_amount ? Number(quote.total_amount) / 100 : null // total_amount em centavos
    if (needApproved && attribution.gclid && approvedValue && approvedValue > 0 && quote?.approved_at && PT_GOOGLE_ADS) {
      const r = await uploadGoogleAdsConversion(
        PT_GOOGLE_ADS,
        googleAccessToken,
        attribution.gclid,
        PT_GOOGLE_ADS.conversionActionApproved,
        approvedValue,
        quote.approved_at,
      )
      if (r.ok) { approvedSent++; newUploaded.approved_at = now.toISOString(); newUploaded.approved_value = String(approvedValue); mutated = true }
      else { approvedFailed++; errors.push(`OS #${os.os_number} APPROVED: ${r.error}`) }
    }

    if (mutated) {
      await prisma.serviceOrder.update({
        where: { id: os.id },
        data: {
          custom_data: { ...cd, conversion_uploaded: newUploaded, attribution_source: attribution.source },
        },
      })
    }
  }

  // CWT WhatsApp clicks → Google Ads. Aditivo: try/catch isola do upload de OS/quote acima —
  // se isto falhar, NÃO afeta o resultado dos uploads de LEAD/APPROVED já processados.
  let whatsappResult = { sent: 0, skipped: 0, failed: 0, errors: [] as string[] }
  try {
    if (PT_GOOGLE_ADS) {
      whatsappResult = await uploadCwtWhatsappConversions(PT_GOOGLE_ADS, googleAccessToken)
    }
  } catch (e: any) {
    whatsappResult.errors.push('cwt upload crashed: ' + (e?.message || 'unknown'))
  }

  console.log(`[Cron/UploadConv] candidates=${byId.size} | leads sent=${leadsSent} skipped=${leadsSkipped} failed=${leadsFailed} | approved sent=${approvedSent} skipped=${approvedSkipped} failed=${approvedFailed} | whatsapp_cwt sent=${whatsappResult.sent} skipped=${whatsappResult.skipped} failed=${whatsappResult.failed}`)

  return success({
    candidates: byId.size,
    leads: { sent: leadsSent, skipped: leadsSkipped, failed: leadsFailed },
    approved: { sent: approvedSent, skipped: approvedSkipped, failed: approvedFailed },
    whatsapp_cwt: whatsappResult,
    errors: errors.slice(0, 10),
    google_ads_configured: !!PT_GOOGLE_ADS?.developerToken,
    bing_ads_configured: !!PT_BING_ADS?.developerToken,
  })
}
