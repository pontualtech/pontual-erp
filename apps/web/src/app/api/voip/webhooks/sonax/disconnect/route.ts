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

function isAllowedSource(req: NextRequest): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || ''

  if (process.env.NODE_ENV !== 'production') return true

  const allowedEnv = process.env.SONAX_WEBHOOK_ALLOWED_IPS
  if (allowedEnv) {
    const allowed = new Set(allowedEnv.split(',').map(s => s.trim()).filter(Boolean))
    return allowed.has(ip)
  }

  return SONAX_ALLOWED_IPS.has(ip)
}

export async function POST(req: NextRequest) {
  // Captura raw hit ANTES de validar
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || ''
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })
  const rawBody = await req.text().catch(() => '')
  let parsedBody: unknown = rawBody
  try { parsedBody = JSON.parse(rawBody) } catch {}

  try {
    if (!isAllowedSource(req)) {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'disconnect', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'forbidden_ip' })
      return error('Forbidden', 403)
    }

    const body = parsedBody as any
    if (!body || typeof body !== 'object') {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'disconnect', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'invalid_body' })
      return success({ ok: false, reason: 'invalid_body' })
    }

    const callId = String(body.call_id || body.callId || body.protocolo || '').trim()
    if (!callId) {
      logWebhookHit({ ts: new Date().toISOString(), endpoint: 'disconnect', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'no_call_id' })
      return success({ ok: false, reason: 'no_call_id' })
    }
    logWebhookHit({ ts: new Date().toISOString(), endpoint: 'disconnect', ip, headers, query: req.nextUrl.search, body: parsedBody, outcome: 'allowed' })

    const direction = body.direction === 'outbound' ? 'outbound' : 'inbound'
    const fromNumber = normalizePhone(String(body.from || body.from_number || ''))
    const toNumber = normalizePhone(String(body.to || body.to_number || ''))
    const didNumber = body.did ? normalizePhone(String(body.did)) : null
    const agentExtension = body.ramal ? String(body.ramal).replace(/\D/g, '') : null

    const startedAt = body.started_at ? new Date(body.started_at) : new Date()
    const answeredAt = body.answered_at ? new Date(body.answered_at) : null
    const endedAt = body.ended_at ? new Date(body.ended_at) : new Date()

    const durationSec = body.duration != null ? Number(body.duration)
      : (answeredAt ? Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000) : null)

    const rawStatus = String(body.status || '').toLowerCase()
    const status = ['answered','missed','busy','no_answer','failed','completed'].includes(rawStatus)
      ? rawStatus
      : (answeredAt ? 'completed' : 'missed')

    const hangupCause = body.hangup_cause ? String(body.hangup_cause).slice(0, 50) : null
    const recordingUrl = body.recording_url ? String(body.recording_url) : null

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
