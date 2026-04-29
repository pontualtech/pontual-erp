/**
 * Webhook Sonax — Call Start
 *
 * Recebe notificação no início de uma chamada (inbound ou outbound).
 * Cria ou atualiza registro VoipCall com status "ringing".
 *
 * NÃO autentica via session — Sonax não tem session. Validação por:
 * - IP origem (Sonax: 200.201.193.85, .212.100, .212.68)
 * - Shared secret opcional (env SONAX_WEBHOOK_SECRET)
 *
 * Payload esperado (Sonax v1):
 *   {
 *     "event": "call.start",
 *     "call_id": "abc-123",
 *     "direction": "inbound" | "outbound",
 *     "from": "11988889999",        // E.164 sem +55 ou com formatação BR
 *     "to": "1131360415",           // mesmo
 *     "did": "1131360415",          // só inbound: qual DID PontualTech foi chamado
 *     "ramal": "101",               // ramal SIP (se identificado)
 *     "started_at": "2026-04-29T11:30:00-03:00"
 *   }
 *
 * Multi-tenant: por enquanto, todos os webhooks são do tenant PontualTech.
 * Quando vier multi-cliente Sonax, identificar via DID/ramal → company_id.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { error, handleError, success } from '@/lib/api-response'
import { normalizePhone, getPhoneSearchVariants } from '@/lib/voip/phone'
import { emitVoipEvent, logWebhookHit } from '@/lib/voip/eventBus'

// IPs autorizados Sonax (ver tag deploy-2026-04-29-telefonia-f2-OK)
const SONAX_ALLOWED_IPS = new Set([
  '200.201.193.85',
  '200.201.212.100',
  '200.201.212.68',
])

// Hardcoded por enquanto (PontualTech é o único tenant com VOIP em prod)
// Quando multi-tenant, descobrir via DID → voip_inbound_numbers.company_id
const PONTUALTECH_COMPANY_ID = process.env.SONAX_DEFAULT_COMPANY_ID || ''

function isAllowedSource(req: NextRequest): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || ''

  // Em desenvolvimento permite tudo
  if (process.env.NODE_ENV !== 'production') return true

  // Se ALLOWED_IPS configurada via env, usar
  const allowedEnv = process.env.SONAX_WEBHOOK_ALLOWED_IPS
  if (allowedEnv) {
    const allowed = new Set(allowedEnv.split(',').map(s => s.trim()).filter(Boolean))
    return allowed.has(ip)
  }

  return SONAX_ALLOWED_IPS.has(ip)
}

// Sonax envia webhook como GET com placeholders <VAR> substituídos na query.
// Em modo "Manual" + URL com placeholders, Sonax chama GET (não POST/JSON).
// Suportamos ambos pra compatibilidade futura.
function extractSonaxPayloadCS(req: NextRequest, parsedBody: any): any {
  const isObj = parsedBody && typeof parsedBody === 'object'
  const fromBody = isObj ? parsedBody : {}
  const sp = req.nextUrl.searchParams
  const fromQuery: any = {}
  sp.forEach((v, k) => { fromQuery[k] = v })
  return { ...fromQuery, ...fromBody }
}

async function handleCallStart(req: NextRequest) {
  // Captura raw hit ANTES da validação pra debug do que Sonax envia
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || ''
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })
  const rawBody = req.method === 'POST' ? (await req.text().catch(() => '')) : ''
  let parsedBody: unknown = rawBody
  try { parsedBody = JSON.parse(rawBody) } catch {}

  try {
    if (!isAllowedSource(req)) {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'call-start', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'forbidden_ip' })
      return error('Forbidden — IP não autorizado', 403)
    }

    const body = extractSonaxPayloadCS(req, parsedBody)
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'call-start', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'invalid_body' })
      return error('Body inválido', 400)
    }

    // Sonax placeholder mapping
    const callId = String(body.call_id || body.callId || body.protocolo || body.id_chamada || body.id_chamada_originador || '').trim()
    if (!callId) {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'call-start', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'no_call_id' })
      return error('call_id obrigatório', 400)
    }

    // Sonax doc KB 159253:
    //   <NUMERO>     = pessoa (origem em receptivas, destino em campanhas)
    //   <NUMERO_REC> = nosso DID (so em receptivas; quem RECEBEU)
    // Direction: query param `?direction=outbound|inbound` override (configurado
    // no URL do webhook Sonax). Senao, default heuristica antiga.
    const directionOverride = String(body.direction || body.DIRECTION || '').toLowerCase()
    const isOutboundOverride = directionOverride === 'outbound'
    const isInboundOverride = directionOverride === 'inbound'
    const isInbound = isInboundOverride || (!isOutboundOverride && !!(body.numero_rec || body.NUMERO_REC))
    const direction: 'inbound' | 'outbound' = isInbound ? 'inbound' : 'outbound'
    const numeroPessoa = String(body.numero || '')
    const numeroDID = String(body.numero_rec || body.NUMERO_REC || '')
    const fromRaw = String(body.from || body.from_number || (isInbound ? numeroPessoa : numeroDID) || '')
    const toRaw = String(body.to || body.to_number || (isInbound ? numeroDID : numeroPessoa) || '')
    const fromNumber = normalizePhone(fromRaw)
    const toNumber = normalizePhone(toRaw)
    const didNumber = body.did ? normalizePhone(String(body.did)) : null
    const agentExtension = String(body.ramal || body.aliasramal || body.ALIASRAMAL || '').replace(/\D/g, '') || null

    // Sonax envia "yyyy-mm-dd hh:mm:ss" em BRT sem TZ. Sem fix, JS parseia
    // como horario local do server (UTC) e a chamada aparece 3h no passado.
    const parseTs = (v: any): Date | null => {
      if (!v) return null
      const s = String(v).trim()
      if (!s) return null
      const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s)
      const iso = s.includes('T') ? s : s.replace(' ', 'T')
      const d = new Date(hasTz ? iso : iso + '-03:00')
      return isNaN(d.getTime()) ? null : d
    }
    const startedAt = parseTs(body.started_at || body.data_inicio || body.DATA_INICIO) || new Date()
    const companyId = PONTUALTECH_COMPANY_ID

    if (!companyId) {
      console.error('[voip-webhook] SONAX_DEFAULT_COMPANY_ID env não configurado')
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'call-start', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'company_not_configured' })
      return error('Configuração faltando', 500)
    }
    // Marca como aceito — vai criar/atualizar
    logWebhookHit({ ts: new Date().toISOString(), endpoint: 'call-start', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'allowed' })

    // Lookup customer por phone (do quem ligou OU pra quem ligou)
    const externalNumber = direction === 'inbound' ? fromNumber : toNumber
    let customerId: string | null = null
    let customerName: string | null = null
    if (externalNumber && externalNumber.length >= 8) {
      const variants = getPhoneSearchVariants(externalNumber)
      const customer = await prisma.customer.findFirst({
        where: {
          company_id: companyId,
          deleted_at: null,
          OR: [
            { phone: { in: variants } },
            { mobile: { in: variants } },
          ],
        },
        select: { id: true, legal_name: true, trade_name: true },
      })
      customerId = customer?.id || null
      customerName = customer?.trade_name || customer?.legal_name || null
    }

    // Upsert: idempotente, mesmo call_id atualiza
    const call = await prisma.voipCall.upsert({
      where: { call_id: callId },
      create: {
        company_id: companyId,
        call_id: callId,
        direction,
        from_number: fromNumber,
        to_number: toNumber,
        did_number: didNumber,
        customer_id: customerId,
        agent_extension: agentExtension,
        started_at: startedAt,
        status: 'ringing',
        raw_webhook: body as object,
      },
      update: {
        // Se webhook duplicado, mantém estado mas atualiza timestamp/raw
        agent_extension: agentExtension,
        raw_webhook: body as object,
        updated_at: new Date(),
      },
    })

    // Empurra evento real-time pro CRM Pop (toast no ERP)
    emitVoipEvent({
      type: 'call.start',
      companyId,
      voipCallId: call.id,
      callId: call.call_id,
      direction: call.direction as 'inbound' | 'outbound',
      fromNumber: call.from_number,
      toNumber: call.to_number,
      customerId: call.customer_id,
      customerName,
      agentExtension: call.agent_extension,
      status: call.status,
      startedAt: call.started_at.toISOString(),
    })

    return success({
      callId: call.call_id,
      voipCallId: call.id,
      customerId: call.customer_id,
      direction: call.direction,
      status: call.status,
    })
  } catch (e) {
    logWebhookHit({ ts: new Date().toISOString(), endpoint: 'call-start', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'error', error: e instanceof Error ? e.message : String(e) })
    return handleError(e)
  }
}

export async function POST(req: NextRequest) { return handleCallStart(req) }
export async function GET(req: NextRequest) { return handleCallStart(req) }
