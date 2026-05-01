/**
 * Webhook Sonax — Call Disconnect
 *
 * Recebe notificação no fim de uma chamada com status, duração e URL CDN do MP3.
 * Atualiza VoipCall existente OU cria nova. Dispara download assíncrono do MP3.
 *
 * Resposta SEMPRE 200 (Sonax não tem retry). Erros logados mas não falham webhook.
 *
 * Payload esperado:
 *   {
 *     "event": "call.disconnect",
 *     "call_id": "abc-123",
 *     "direction": "inbound" | "outbound",
 *     "from": "11988889999",
 *     "to": "1131360415",
 *     "ramal": "101",
 *     "started_at": "2026-04-29T11:30:00-03:00",
 *     "answered_at": "2026-04-29T11:30:08-03:00" | null,
 *     "ended_at": "2026-04-29T11:34:22-03:00",
 *     "duration": 254,
 *     "status": "answered" | "missed" | "busy" | "no_answer" | "failed",
 *     "hangup_cause": "NORMAL_CLEARING",
 *     "recording_url": "https://gravacoes.sonax.net.br/abc-123.mp3"
 *   }
 */

import { NextRequest } from 'next/server'
import { timingSafeEqual, createHmac } from 'crypto'
import { prisma } from '@pontual/db'
import { error, success } from '@/lib/api-response'
import { normalizePhone, getPhoneSearchVariants } from '@/lib/voip/phone'
import { downloadRecording } from '@/lib/voip/recording'
import { emitVoipEvent, logWebhookHit, type VoipEvent } from '@/lib/voip/eventBus'

const SONAX_ALLOWED_IPS = new Set([
  '200.201.193.85',
  '200.201.212.100',
  '200.201.212.68',
])

const PONTUALTECH_COMPANY_ID = process.env.SONAX_DEFAULT_COMPANY_ID || ''

/**
 * A10 fix (audit): HMAC + IP allowlist + dev bypass explícito (sem NODE_ENV)
 */
function isAllowedSource(req: NextRequest, rawBody: string): boolean {
  if (process.env.SONAX_WEBHOOK_DEV_BYPASS === '1') {
    console.warn('[Sonax disconnect] SONAX_WEBHOOK_DEV_BYPASS=1 ATIVO — não usar em produção')
    return true
  }

  const secret = process.env.SONAX_WEBHOOK_SECRET
  const sig = req.headers.get('x-sonax-signature')
  if (secret && sig) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    try {
      if (sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return true
      }
    } catch {}
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || ''
  const allowedEnv = process.env.SONAX_WEBHOOK_ALLOWED_IPS
  if (allowedEnv) {
    const allowed = new Set(allowedEnv.split(',').map(s => s.trim()).filter(Boolean))
    return allowed.has(ip)
  }
  return SONAX_ALLOWED_IPS.has(ip)
}

// Extrai payload tanto de body JSON (POST/JSON) quanto de query string (GET com
// placeholders Sonax). Sonax docs: api-de-integracao-de-voz — manda GET com
// vars tipo id_chamada, numero, ramal, status_chamada, url_gravacao etc.
function extractSonaxPayload(req: NextRequest, parsedBody: any): any {
  const isObj = parsedBody && typeof parsedBody === 'object'
  const fromBody = isObj ? parsedBody : {}
  const sp = req.nextUrl.searchParams
  const fromQuery: any = {}
  sp.forEach((v, k) => { fromQuery[k] = v })
  // body tem prioridade — mas filas Sonax mandam tudo via query
  return { ...fromQuery, ...fromBody }
}

async function handleDisconnect(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || ''
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })
  const rawBody = req.method === 'POST' ? (await req.text().catch(() => '')) : ''
  let parsedBody: unknown = rawBody
  try { parsedBody = JSON.parse(rawBody) } catch {}

  try {
    if (!isAllowedSource(req, rawBody)) {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'disconnect', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'forbidden_ip' })
      return error('Forbidden — falha de autenticação (HMAC ou IP)', 403)
    }

    const body = extractSonaxPayload(req, parsedBody)
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'disconnect', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'invalid_body' })
      return success({ ok: false, reason: 'invalid_body' })
    }

    // Mapping Sonax placeholders <VAR> → campos internos
    const callId = String(body.call_id || body.callId || body.protocolo || body.id_chamada || body.id_chamada_originador || '').trim()
    if (!callId) {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'disconnect', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'no_call_id' })
      return success({ ok: false, reason: 'no_call_id' })
    }
    logWebhookHit({ ts: new Date().toISOString(), endpoint: 'disconnect', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'allowed' })

    // Sonax doc KB 159253:
    //   <NUMERO>     = numero da pessoa (origem em receptivas, destino em campanhas)
    //   <NUMERO_REC> = numero do DID (somente em receptivas; quem RECEBEU)
    //   Status atendimento: "S" = atendida, "N" = perdida
    // Receptiva: tem numero_rec preenchido. Ativa: nao tem.
    // Direction: query param `?direction=outbound|inbound` override (configurado
    // no URL do webhook Sonax) — necessario quando a fila inbound tambem captura
    // chamadas outbound do mesmo ramal logado.
    const directionOverride = String(body.direction || body.DIRECTION || '').toLowerCase()
    const isOutboundOverride = directionOverride === 'outbound'
    const isInboundOverride = directionOverride === 'inbound'
    const isInbound = isInboundOverride || (!isOutboundOverride && !!(body.numero_rec || body.NUMERO_REC))
    const direction: 'inbound' | 'outbound' = isInbound ? 'inbound' : 'outbound'
    // Em INBOUND: from = numero (cliente que ligou), to = numero_rec (nosso DID)
    // Em OUTBOUND: from = nosso DID, to = numero (destino externo)
    const numeroPessoa = String(body.numero || '')
    const numeroDID = String(body.numero_rec || body.NUMERO_REC || '')
    const fromNumber = normalizePhone(String(body.from || body.from_number || (isInbound ? numeroPessoa : numeroDID) || ''))
    const toNumber = normalizePhone(String(body.to || body.to_number || (isInbound ? numeroDID : numeroPessoa) || ''))
    // did_number = nosso numero (numero_rec). Em inbound = linha que cliente discou.
    // Em outbound = caller ID. Cai no body.did se Sonax mandar explicito.
    const didNumber = numeroDID ? normalizePhone(numeroDID) : (body.did ? normalizePhone(String(body.did)) : null)
    const agentExtension = body.ramal ? String(body.ramal).replace(/\D/g, '') : null

    // Sonax envia DATA_INICIO/DATA_FIM como "yyyy-mm-dd hh:mm:ss" em BRT sem TZ.
    // Sem fix, JS parseia como horario local do server (UTC) e o registro fica 3h
    // no passado, sumindo do topo do listing.
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
    const answeredAt = parseTs(body.answered_at || body.data_atendimento)
    const endedAt = parseTs(body.ended_at || body.data_fim || body.DATA_FIM) || new Date()

    const durationSec = body.duration != null
      ? Number(body.duration)
      : (body.duracao != null ? Number(body.duracao) : (body.duracao_chamada != null ? Number(body.duracao_chamada) : null))

    // status_atendimento: "S" = atendida, "N" = não atendida (Sonax)
    const statusAtendimento = String(body.status_atendimento || body.STATUS_ATENDIMENTO || '').toUpperCase()
    const statusChamada = String(body.status_chamada || body.STATUS_CHAMADA || body.status || '').toLowerCase()
    let status = 'missed'
    if (statusAtendimento === 'S') status = 'answered'
    else if (statusAtendimento === 'N') status = 'missed'
    else if (['answered','missed','busy','no_answer','failed','completed'].includes(statusChamada)) {
      status = statusChamada
    } else if (statusChamada.includes('ramal atendeu') || statusChamada.includes('falando') || statusChamada === 'desligada') {
      status = 'answered'
    } else if (statusChamada.includes('ocupado')) status = 'busy'
    else if (statusChamada.includes('falhou') || statusChamada.includes('indispon')) status = 'no_answer'

    const hangupCause = body.hangup_cause ? String(body.hangup_cause).slice(0, 50) : null
    // Sonax: <URL_GRAVACAO> chega como url_gravacao (placeholder substituído)
    const recordingUrl = String(body.recording_url || body.url_gravacao || body.URL_GRAVACAO || '').trim() || null

    const companyId = PONTUALTECH_COMPANY_ID
    if (!companyId) {
      console.error('[voip-webhook-disconnect] SONAX_DEFAULT_COMPANY_ID env não configurado')
      return success({ ok: false, reason: 'company_not_configured' })
    }

    // Lookup customer
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

    // Lookup user pelo ramal (via SONAX_RAMAL_MAPPING)
    let agentUserId: string | null = null
    if (agentExtension) {
      try {
        const mapping = JSON.parse(process.env.SONAX_RAMAL_MAPPING || '{}') as Record<string, string>
        const emailEntry = Object.entries(mapping).find(([_, ramal]) => ramal === agentExtension)
        if (emailEntry) {
          const user = await prisma.userProfile.findFirst({
            where: { company_id: companyId, email: emailEntry[0] },
            select: { id: true },
          })
          agentUserId = user?.id || null
        }
      } catch {
        // mapping malformado, ignora
      }
    }

    // Upsert
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
        agent_user_id: agentUserId,
        started_at: startedAt,
        answered_at: answeredAt,
        ended_at: endedAt,
        duration_sec: durationSec,
        status,
        hangup_cause: hangupCause,
        recording_url: recordingUrl,
        raw_webhook: body as object,
      },
      update: {
        answered_at: answeredAt ?? undefined,
        ended_at: endedAt,
        duration_sec: durationSec ?? undefined,
        status,
        hangup_cause: hangupCause ?? undefined,
        recording_url: recordingUrl ?? undefined,
        agent_extension: agentExtension ?? undefined,
        agent_user_id: agentUserId ?? undefined,
        customer_id: customerId ?? undefined,
        raw_webhook: body as object,
        updated_at: new Date(),
      },
    })

    // Download assíncrono da gravação (fire-and-forget, não bloqueia)
    if (recordingUrl) {
      downloadRecording({
        recordingUrl,
        companyId,
        callId,
        startedAt,
      })
        .then(async (result) => {
          if (result.ok && result.localPath) {
            await prisma.voipCall.update({
              where: { call_id: callId },
              data: {
                recording_path: result.localPath,
                recording_size_kb: result.sizeBytes ? Math.round(result.sizeBytes / 1024) : undefined,
              },
            })
          } else {
            console.error('[voip-recording-download] failed:', result.error, callId)
          }
        })
        .catch(e => console.error('[voip-recording-download] exception:', e))
    }

    // Empurra evento real-time pro CRM Pop:
    //   - answered/completed → toast verde curto "atendida"
    //   - missed/no_answer/busy/failed → toast vermelho "perdida" com botão Retornar
    const eventType: VoipEvent['type'] = (status === 'answered' || status === 'completed')
      ? 'call.answered'
      : 'call.missed'
    emitVoipEvent({
      type: eventType,
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
      status: call.status,
      durationSec: call.duration_sec,
      hasRecording: !!recordingUrl,
    })
  } catch (e) {
    console.error('[voip-webhook-disconnect] error:', e)
    return success({ ok: false, reason: 'internal_error' })
  }
}

export async function POST(req: NextRequest) { return handleDisconnect(req) }
export async function GET(req: NextRequest) { return handleDisconnect(req) }
