/**
 * GET /api/voip/calls/[id]/recording — stream MP3 da gravação local
 *
 * Path traversal-safe: só serve arquivos dentro de VOIP_RECORDINGS_PATH (/var/recordings).
 * Auth: requireAuth + valida company_id (multi-tenant).
 *
 * Se a gravação ainda não foi baixada (recording_path null), tenta download síncrono.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { error, handleError } from '@/lib/api-response'
import { downloadRecording, readRecording, fetchRecordingViaSonaxApi } from '@/lib/voip/recording'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth()

    const call = await prisma.voipCall.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
      },
      select: {
        id: true,
        call_id: true,
        company_id: true,
        recording_url: true,
        recording_path: true,
        started_at: true,
      },
    })

    if (!call) return error('Chamada não encontrada', 404)
    if (!call.recording_url) return error('Sem gravação disponível', 404)

    // Estrategia: tenta servir do cache local. Se nao tem (Persistent Storage
    // pode nao estar montado, ou download falhou), faz proxy do MP3 do CDN
    // Sonax direto. URL Sonax e' publica (testado, retorna 200 + audio/mpeg).

    // 1) Cache local
    if (call.recording_path) {
      const buffer = await readRecording(call.recording_path).catch(() => null)
      if (buffer && buffer.length > 0) {
        return new NextResponse(buffer as any, {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(buffer.length),
            'Content-Disposition': `inline; filename="call-${call.call_id}.mp3"`,
            'Cache-Control': 'private, max-age=3600',
          },
        })
      }
    }

    // 2) Tenta baixar e cachear (best-effort, nao bloqueia se falhar)
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
            headers: {
              'Content-Type': 'audio/mpeg',
              'Content-Length': String(buffer.length),
              'Content-Disposition': `inline; filename="call-${call.call_id}.mp3"`,
              'Cache-Control': 'private, max-age=3600',
            },
          })
        }
      }
    } catch (e) {
      console.error('[voip-recording] download local falhou:', e)
      // segue pro proxy direto
    }

    // 3) Tenta CDN Sonax direto (URL com token assinado)
    try {
      const cdnRes = await fetch(call.recording_url, {
        signal: AbortSignal.timeout(30_000),
      })
      const buf = Buffer.from(await cdnRes.arrayBuffer())
      // Sonax responde HTTP 200 com body texto "404 not found" quando grava
      // ainda nao processada — detecta e cai pro fallback API
      const looksLikeAudio = buf.length > 100 && (
        (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || // "ID3" tag MP3
        (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)              // MP3 frame sync
      )
      if (cdnRes.ok && looksLikeAudio) {
        return new NextResponse(buf as any, {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(buf.length),
            'Content-Disposition': `inline; filename="call-${call.call_id}.mp3"`,
            'Cache-Control': 'private, max-age=3600',
          },
        })
      }
      console.warn('[voip-recording] CDN Sonax retornou nao-audio:', buf.toString('utf-8').slice(0, 100))
    } catch (e) {
      console.error('[voip-recording] CDN Sonax falhou:', e)
    }

    // 4) Fallback: API server-to-server Sonax (pega_gravacao por id_chamada)
    try {
      const apiRes = await fetchRecordingViaSonaxApi(call.call_id)
      if (apiRes.ok && apiRes.buffer) {
        return new NextResponse(apiRes.buffer as any, {
          status: 200,
          headers: {
            'Content-Type': apiRes.contentType || 'audio/mpeg',
            'Content-Length': String(apiRes.buffer.length),
            'Content-Disposition': `inline; filename="call-${call.call_id}.mp3"`,
            'Cache-Control': 'private, max-age=3600',
          },
        })
      }
      return error(`Gravação não disponível ainda (${apiRes.error || 'sem detalhe'}). Tente em alguns minutos.`, 503)
    } catch (e) {
      console.error('[voip-recording] API Sonax falhou:', e)
      return error('Falha ao buscar gravação', 502)
    }
  } catch (e) {
    return handleError(e)
  }
}
