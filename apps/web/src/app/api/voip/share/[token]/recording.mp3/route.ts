/**
 * GET /api/voip/share/[token]/recording.mp3 — endpoint PUBLICO (sem auth)
 *
 * Valida HMAC token e serve o MP3. Segue mesma estrategia 4-niveis do
 * endpoint autenticado: cache local → download → CDN proxy → API Sonax.
 *
 * Token gerado por POST /api/voip/calls/[id]/share. TTL default 7 dias.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { error, handleError } from '@/lib/api-response'
import { downloadRecording, readRecording, fetchRecordingViaSonaxApi } from '@/lib/voip/recording'
import { verifyShareToken } from '@/lib/voip/share-token'
import { rateLimit } from '@/lib/rate-limit'

// public — middleware bypass: rota fora de matcher? Verificar.
// `/api/voip/share/...` deve estar em allowlist do middleware.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const ip = _req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || _req.ip || 'unknown'
  try {
    // N29 fix (audit pos-fix): rate limit + audit log download.
    // Áudio é dado pessoal sensível (voz) — LGPD requer trilha.
    const rl = rateLimit(`recording-share:${ip}`, 30, 60 * 1000)
    if (!rl.allowed) return error('Muitas tentativas', 429)

    const payload = verifyShareToken(params.token)
    if (!payload) return error('Link expirado ou invalido', 403)

    const call = await prisma.voipCall.findUnique({
      where: { id: payload.callId },
      select: {
        id: true,
        call_id: true,
        company_id: true,
        recording_url: true,
        recording_path: true,
        started_at: true,
      },
    })
    if (!call) return error('Chamada nao encontrada', 404)
    if (!call.recording_url) return error('Sem gravacao disponivel', 404)

    // N29: audit log download (LGPD trilha de quem acessou áudio sensível)
    try {
      await prisma.auditLog.create({
        data: {
          company_id: call.company_id,
          user_id: 'system:share-link',
          module: 'voip',
          action: 'recording_share_download',
          entity_id: call.id,
          ip_address: ip,
          new_value: { call_id: call.call_id },
        },
      })
    } catch {}

    const filename = `call-${call.call_id}.mp3`
    const baseHeaders = {
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'public, max-age=3600',
    }

    // 1) Cache local
    if (call.recording_path) {
      const buffer = await readRecording(call.recording_path).catch(() => null)
      if (buffer && buffer.length > 0) {
        return new NextResponse(buffer as any, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': String(buffer.length) },
        })
      }
    }

    // 2) Tenta baixar e cachear
    try {
      const result = await downloadRecording({
        recordingUrl: call.recording_url,
        companyId: call.company_id,
        callId: call.call_id,
        startedAt: call.started_at,
      })
      if (result.ok && result.localPath) {
        await prisma.voipCall.update({
          where: { id: call.id },
          data: {
            recording_path: result.localPath,
            recording_size_kb: result.sizeBytes ? Math.round(result.sizeBytes / 1024) : undefined,
          },
        }).catch(() => {})
        const buffer = await readRecording(result.localPath).catch(() => null)
        if (buffer && buffer.length > 0) {
          return new NextResponse(buffer as any, {
            status: 200,
            headers: { ...baseHeaders, 'Content-Length': String(buffer.length) },
          })
        }
      }
    } catch {}

    // 3) CDN Sonax direto
    try {
      const cdnRes = await fetch(call.recording_url, { signal: AbortSignal.timeout(30_000) })
      const buf = Buffer.from(await cdnRes.arrayBuffer())
      const looksLikeAudio = buf.length > 100 && (
        (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
        (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
      )
      if (cdnRes.ok && looksLikeAudio) {
        return new NextResponse(buf as any, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': String(buf.length) },
        })
      }
    } catch {}

    // 4) Fallback API Sonax
    try {
      const apiRes = await fetchRecordingViaSonaxApi(call.call_id)
      if (apiRes.ok && apiRes.buffer) {
        return new NextResponse(apiRes.buffer as any, {
          status: 200,
          headers: {
            ...baseHeaders,
            'Content-Type': apiRes.contentType || 'audio/mpeg',
            'Content-Length': String(apiRes.buffer.length),
          },
        })
      }
    } catch {}

    return error('Gravacao nao disponivel', 503)
  } catch (e) {
    return handleError(e)
  }
}
