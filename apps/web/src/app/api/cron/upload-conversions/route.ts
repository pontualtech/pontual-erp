/**
 * GET /api/cron/upload-conversions
 *
 * Cron diário (chamado por n8n/crontab a cada 6h ou 24h) que envia conversões
 * offline pro Google Ads e Microsoft Ads. Fecha o loop "clique no anúncio →
 * venda real" pros algoritmos de bid otimizarem.
 *
 * Eventos enviados (decisão Karlão 2026-05-21):
 *   - LEAD (OS criada): valor estimado, conversion_action GOOGLE_ADS_LEAD_ACTION_ID
 *   - APPROVED (orçamento aprovado): valor real (service_orders.approved_cost, data = 1ª transição
 *     p/ status Aprovado em service_order_history), action GOOGLE_ADS_CONV_ACTION_APPROVED
 *     Só sobe com clique comprovadamente do cliente (portão lib/ads/click-match, 2026-10-10);
 *     motivo das barradas no log ([Cron/UploadConv] ... unreliable=N {motivos}).
 *     LEAD ainda sem portão: filtrar leads muda o volume que a Pesquisa (tCPA) enxerga — passo separado.
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
import {
  decideClickMatch, pickCustomerConsumption, FINGERPRINT_WINDOW_MS, CLOCK_TOLERANCE_MS, CLICK_TO_MESSAGE_MAX_MS,
  type ClickMatchReason, type CustomerConsumption,
} from '@/lib/ads/click-match'
import { getConversationInboxId } from '@/lib/chatwoot'

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

/**
 * Portão de venda (2026-10-10): junta as provas do clique — ancoradas no redirect e no DONO dele
 * (conversa do cliente da OS, pelo telefone), não na origem atual da conversa, que o fingerprint
 * pode ter reescrito — e decide em lib/ads/click-match. Erro de banco/Chatwoot = não envia.
 */
async function checkSaleClick(
  companyId: string,
  gclid: string,
  os: { id: string; customer_id: string; created_at: Date | null; customers?: { mobile?: string | null; phone?: string | null } | null },
  salesInboxes: Set<number>,
  ctx: { chatwootDown: boolean },
): Promise<{ ok: boolean; reason: ClickMatchReason }> {
  try {
    const variants = [...new Set([gclid, gclid.replace(/\*/g, '_')])] // mesmo workaround do upload
    const phone = (os.customers?.mobile || os.customers?.phone || '').replace(/\D/g, '')
    const customerConvs = phone.length >= 10
      ? await prisma.botConversation.findMany({
        where: { company_id: companyId, customer_phone: { endsWith: phone.slice(-10) } },
        select: { chatwoot_conv_id: true, inbox_id: true, created_at: true },
      })
      : []
    const customerConvIds = new Set(customerConvs.map(c => c.chatwoot_conv_id))

    const clickRows = await prisma.marketingWhatsappRedirect.findMany({
      where: { company_id: companyId, gclid: { in: variants } },
      select: { id: true, click_at: true, consumed_at: true, consumed_by_conv_id: true },
    })
    const clicks = clickRows.map(r => ({ id: r.id, clickAt: r.click_at, consumedAt: r.consumed_at, consumedByConvId: r.consumed_by_conv_id }))

    // Etiqueta [ref:]: o bot grava a origem sem source/redirect_id (só o fingerprint marca os dois)
    const withGclid = await prisma.botConversation.findMany({
      where: { company_id: companyId, OR: variants.map(v => ({ attribution: { path: ['gclid'], equals: v } })) },
      select: { chatwoot_conv_id: true, attribution: true },
    })
    const tokenConvs = withGclid
      .filter(c => {
        const a = c.attribution as Record<string, unknown> | null
        return !!a && a.source == null && a.redirect_id == null
      })
      .map(c => {
        const cap = (c.attribution as Record<string, unknown>).captured_at
        const ms = typeof cap === 'string' ? Date.parse(cap) : NaN
        return { chatwootConvId: c.chatwoot_conv_id, capturedAt: Number.isFinite(ms) ? new Date(ms) : null }
      })

    // Disputa entre clientes: o mesmo gclid na OS de outro cliente, ou consumido pela conversa NOVA
    // de outro cliente (conversa antiga que "roubou" o clique não disputa a autoria).
    const otherCustomerOsWithGclid = await prisma.serviceOrder.count({
      where: {
        company_id: companyId,
        id: { not: os.id },
        customer_id: { not: os.customer_id },
        deleted_at: null,
        OR: variants.map(v => ({ custom_data: { path: ['tracking', 'gclid'], equals: v } })),
      },
    })
    const otherRows = clicks.filter(c => c.consumedByConvId != null && !customerConvIds.has(c.consumedByConvId))
    let otherNewConsumers = 0
    if (otherRows.length) {
      const otherConvs = await prisma.botConversation.findMany({
        where: { company_id: companyId, chatwoot_conv_id: { in: otherRows.map(c => c.consumedByConvId!) } },
        select: { chatwoot_conv_id: true, created_at: true },
      })
      const createdBy = new Map(otherConvs.map(c => [c.chatwoot_conv_id, c.created_at.getTime()]))
      otherNewConsumers = otherRows.filter(c => {
        const created = createdBy.get(c.consumedByConvId!)
        const click = c.clickAt.getTime()
        return created != null && created >= click - CLOCK_TOLERANCE_MS
          && !!c.consumedAt && c.consumedAt.getTime() - click <= CLICK_TO_MESSAGE_MAX_MS
      }).length
    }

    const picked = pickCustomerConsumption(clicks, customerConvIds)
    let consumption: CustomerConsumption | null = null
    let freeClicksInWindow = 0
    if (picked?.consumedAt && picked.consumedByConvId != null) {
      const conv = customerConvs.find(c => c.chatwoot_conv_id === picked.consumedByConvId)!
      consumption = { clickAt: picked.clickAt, consumedAt: picked.consumedAt, conversation: { inboxId: conv.inbox_id, createdAt: conv.created_at } }
      // Cliques ainda livres na janela do fingerprint no instante do consumo (>0 = o bot pode ter pego o de outro).
      // Linhas do MESMO gclid (o visitante clicou 2x) não competem.
      freeClicksInWindow = await prisma.marketingWhatsappRedirect.count({
        where: {
          company_id: companyId,
          id: { not: picked.id },
          click_at: { gte: new Date(picked.consumedAt.getTime() - FINGERPRINT_WINDOW_MS), lte: picked.consumedAt },
          AND: [
            { OR: [{ consumed_at: null }, { consumed_at: { gt: picked.consumedAt } }] },
            { OR: [{ gclid: null }, { gclid: { notIn: variants } }] },
          ],
        },
      })
    }

    const input = {
      clicks, customerConvIds, otherCustomerOsWithGclid, otherNewConsumers, tokenConvs, consumption,
      freeClicksInWindow, osCreatedAt: os.created_at, salesInboxes,
    }
    const first = decideClickMatch(input)
    if (first.reason !== 'caixa_desconhecida' || !consumption) return first
    // Tudo passou e só falta a caixa (bot não gravou inbox_id): pergunta ao Chatwoot. Depois da
    // 1ª falha na rodada não insiste (timeout/retry de ~30 s por chamada atrasaria a rodada).
    if (ctx.chatwootDown) return { ok: false, reason: 'erro' }
    let inboxId: number | null
    try {
      inboxId = await getConversationInboxId(picked!.consumedByConvId!)
    } catch (e: any) {
      // 4xx (conversa apagada/sem acesso) é desta OS só; timeout, 5xx e rede desligam a consulta na rodada.
      const status = Number((/Chatwoot API (\d{3})/.exec(String(e?.message)) || [])[1])
      if (status >= 400 && status < 500 && status !== 429) return { ok: false, reason: 'caixa_desconhecida' }
      ctx.chatwootDown = true
      console.warn(`[Cron/UploadConv] Chatwoot indisponível p/ o portão de venda: ${e?.message}`)
      return { ok: false, reason: 'erro' }
    }
    return decideClickMatch({ ...input, consumption: { ...consumption, conversation: { ...consumption.conversation, inboxId } } })
  } catch (e: any) {
    console.warn(`[Cron/UploadConv] portão de venda falhou (não envia): ${e?.message}`)
    return { ok: false, reason: 'erro' }
  }
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
    const url = `https://googleads.googleapis.com/v22/customers/${cfg.customerId}:uploadClickConversions`
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
    let res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    let data = await res.json()
    // 2026-10-09: rodadas 02:00/05:02 receberam 401 UNAUTHENTICATED a partir da ~8ª chamada com token
    // recém-emitido (do PC externo o mesmo token/gclid responde 200). Diagnóstico: registrar se houve
    // redirect (fetch do Node descarta Authorization em redirect cross-origin) e www-authenticate;
    // mitigação: 1 retry com token novo.
    if (res.status === 401) {
      const diag = `redirected=${res.redirected} url=${res.url} www-authenticate=${res.headers.get('www-authenticate') || '-'}`
      const fresh = await getGoogleAdsAccessToken(cfg)
      if (fresh && fresh !== accessToken) {
        headers['Authorization'] = `Bearer ${fresh}`
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
        data = await res.json()
        if (res.ok && !data.partialFailureError) {
          console.warn(`[Cron/UploadConv] 401 recuperado com token novo (${diag})`)
          return { ok: true }
        }
      }
      return { ok: false, error: `Google Ads API 401 (${diag}; retry=${fresh ? res.status : 'sem token'}): ${JSON.stringify(data).slice(0, 200)}` }
    }
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

  // Candidatos LEAD: OS criadas no período
  const osCreatedRecent = await prisma.serviceOrder.findMany({
    where: { company_id: PT_COMPANY_ID, created_at: { gte: since }, deleted_at: null },
    include: { customers: true },
    take: 500,
  })

  // Candidatos APPROVED (fix 2026-10-08): a aprovação é gravada na OS (status "Aprovado" +
  // approved_cost + linha em service_order_history), NÃO em quotes.approved_at — que nunca é
  // preenchida, logo 0 vendas chegavam ao Google. Fonte agora = histórico de transições p/ o
  // status Aprovado. Janela de 85d (a ação "OS Approved" tem lookback de 90d sobre o clique);
  // isso também faz o backfill das aprovações recentes ainda não enviadas. Idempotência segue
  // em custom_data.conversion_uploaded.approved_at. Cap de 100 UPLOADS TENTADOS por run (no loop
  // abaixo, não na fila: OS sem gclid nunca são marcadas e, contadas na fila, travavam-na).
  const sinceApproved = new Date(now.getTime() - 85 * 24 * 60 * 60 * 1000)
  const approvedStatus = await prisma.moduleStatus.findFirst({
    where: { company_id: PT_COMPANY_ID, module: 'os', name: { contains: 'Aprovad', mode: 'insensitive' } },
    select: { id: true },
  })
  const approvedAtByOs = new Map<string, Date>() // 1ª transição p/ Aprovado = data da conversão
  if (approvedStatus) {
    const hist = await prisma.serviceOrderHistory.findMany({
      where: { company_id: PT_COMPANY_ID, to_status_id: approvedStatus.id, created_at: { gte: sinceApproved } },
      select: { service_order_id: true, created_at: true },
      orderBy: { created_at: 'asc' },
      take: 2000,
    })
    for (const h of hist) {
      if (h.created_at && !approvedAtByOs.has(h.service_order_id)) approvedAtByOs.set(h.service_order_id, h.created_at)
    }
  }
  const osApproved = approvedAtByOs.size ? await prisma.serviceOrder.findMany({
    where: { id: { in: [...approvedAtByOs.keys()] }, company_id: PT_COMPANY_ID, approved_cost: { gt: 0 }, deleted_at: null },
    include: { customers: true },
  }) : []

  // Index por os.id pra evitar processar 2x quando criada+aprovada na mesma janela
  const byId = new Map<string, { os: any; needLead: boolean; needApproved: boolean }>()
  for (const os of osCreatedRecent) {
    byId.set(os.id, { os, needLead: true, needApproved: false })
  }
  // Aprovações mais novas primeiro: é o sinal que mais importa pro lance, e (2026-10-10) garante que
  // a venda aprovada hoje entre no limite de avaliações do portão mesmo com OS antiga.
  osApproved.sort((a, b) => (approvedAtByOs.get(b.id)?.getTime() || 0) - (approvedAtByOs.get(a.id)?.getTime() || 0))
  for (const os of osApproved) {
    const cd = (os.custom_data as Record<string, any> | null) || {}
    if (cd.conversion_uploaded?.approved_at) continue        // já enviada
    if (!os.created_at || os.created_at < sinceApproved) continue // clique fora da janela de 90d → Google rejeitaria (EXPIRED_EVENT)
    const entry = byId.get(os.id)
    if (entry) entry.needApproved = true
    else byId.set(os.id, { os, needLead: false, needApproved: true })
  }

  let leadsSent = 0, leadsSkipped = 0, leadsFailed = 0
  let approvedSent = 0, approvedSkipped = 0, approvedFailed = 0, approvedDeferred = 0
  let approvedUnreliable = 0
  const unreliableReasons: Record<string, number> = {}
  const GATE_MAX_CHECKS_PER_RUN = 200
  let gateChecks = 0
  const gateCtx = { chatwootDown: false }
  const APPROVED_MAX_ATTEMPTS_PER_RUN = 100
  const errors: string[] = []

  // Caixas de venda = as da Ana (mesmo setting que o bot usa); sem o setting, o default do bot.
  const inboxSetting = await prisma.setting.findFirst({
    where: { company_id: PT_COMPANY_ID, key: 'bot.config.allowed_inboxes' },
    select: { value: true },
  })
  const salesInboxes = new Set(
    (inboxSetting?.value || '2,4,9').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n)),
  )

  // OAuth refresh UMA VEZ por cron run (fix 2026-05-28: múltiplos refreshes
  // em sequência causavam 401 esporádico). access_token válido 3600s.
  const googleAccessToken = PT_GOOGLE_ADS ? await getGoogleAdsAccessToken(PT_GOOGLE_ADS) : null
  if (PT_GOOGLE_ADS && !googleAccessToken) {
    // 2026-10-08: refresh token expirado em prod passou meses despercebido — todo upload caía em
    // "credentials not configured" dentro do JSON de resposta que ninguém lê. Log explícito.
    console.error('[Cron/UploadConv] Google Ads OAuth refresh FALHOU (GOOGLE_ADS_REFRESH_TOKEN inválido/expirado?) — nenhum upload será feito nesta rodada')
  }

  for (const entry of byId.values()) {
    const { os } = entry
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

    const approvedValue = os.approved_cost ? Number(os.approved_cost) / 100 : null // approved_cost em centavos
    const approvedAt = approvedAtByOs.get(os.id)
    if (needApproved && attribution.gclid && approvedValue && approvedValue > 0 && approvedAt && PT_GOOGLE_ADS
      && approvedSent + approvedFailed >= APPROVED_MAX_ATTEMPTS_PER_RUN) {
      approvedDeferred++ // fica pra próxima rodada (6h)
    } else if (needApproved && attribution.gclid && approvedValue && approvedValue > 0 && approvedAt && PT_GOOGLE_ADS) {
      // Portão (2026-10-10): venda só sobe com clique comprovadamente do cliente. Barrada não conta
      // como tentativa no cap e NÃO é marcada na OS por ora (reavaliada a cada rodada; motivos no log)
      // — marcar só depois de observar algumas rodadas, para não congelar falso negativo.
      let match: { ok: boolean; reason: ClickMatchReason } | null = null
      if (gateChecks < GATE_MAX_CHECKS_PER_RUN) {
        gateChecks++
        match = await checkSaleClick(PT_COMPANY_ID, attribution.gclid, os, salesInboxes, gateCtx)
      }
      if (!match) {
        approvedDeferred++ // limite de avaliações da rodada (mais novas primeiro) — fica pra próxima
      } else if (!match.ok) {
        approvedUnreliable++
        unreliableReasons[match.reason] = (unreliableReasons[match.reason] || 0) + 1
      } else {
        const r = await uploadGoogleAdsConversion(
          PT_GOOGLE_ADS,
          googleAccessToken,
          attribution.gclid,
          PT_GOOGLE_ADS.conversionActionApproved,
          approvedValue,
          approvedAt,
        )
        if (r.ok) { approvedSent++; newUploaded.approved_at = now.toISOString(); newUploaded.approved_value = String(approvedValue); mutated = true }
        else { approvedFailed++; errors.push(`OS #${os.os_number} APPROVED: ${r.error}`) }
      }
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

  console.log(`[Cron/UploadConv] candidates=${byId.size} | leads sent=${leadsSent} skipped=${leadsSkipped} failed=${leadsFailed} | approved sent=${approvedSent} skipped=${approvedSkipped} failed=${approvedFailed} deferred=${approvedDeferred} unreliable=${approvedUnreliable} ${JSON.stringify(unreliableReasons)} | whatsapp_cwt sent=${whatsappResult.sent} skipped=${whatsappResult.skipped} failed=${whatsappResult.failed}`)
  // A resposta HTTP costuma morrer no proxy (rodada > 60s) — erros precisam ir pro log do container.
  for (const e of errors.slice(0, 10)) console.warn('[Cron/UploadConv] ' + e)
  for (const e of whatsappResult.errors.slice(0, 3)) console.warn('[Cron/UploadConv] cwt: ' + e)

  return success({
    candidates: byId.size,
    leads: { sent: leadsSent, skipped: leadsSkipped, failed: leadsFailed },
    approved: { sent: approvedSent, skipped: approvedSkipped, failed: approvedFailed, unreliable: approvedUnreliable, unreliable_reasons: unreliableReasons },
    whatsapp_cwt: whatsappResult,
    errors: errors.slice(0, 10),
    google_ads_configured: !!PT_GOOGLE_ADS?.developerToken,
    google_ads_token_ok: !!googleAccessToken,
    bing_ads_configured: !!PT_BING_ADS?.developerToken,
  })
}
