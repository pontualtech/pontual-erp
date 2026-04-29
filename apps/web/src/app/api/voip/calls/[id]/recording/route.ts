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
import { downloadRecording, readRecording } from '@/lib/voip/recording'

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

    // 3) Proxy stream direto do Sonax CDN (sem cache local). URL e' publica.
    try {
      const cdnRes = await fetch(call.recording_url, {
        signal: AbortSignal.timeout(30_000),
      })
      if (!cdnRes.ok || !cdnRes.body) {
        return error(`Sonax CDN HTTP ${cdnRes.status}`, 502)
      }
      return new NextResponse(cdnRes.body as any, {
        status: 200,
        headers: {
          'Content-Type': cdnRes.headers.get('content-type') || 'audio/mpeg',
          'Content-Length': cdnRes.headers.get('content-length') || '',
          'Content-Disposition': `inline; filename="call-${call.call_id}.mp3"`,
          'Cache-Control': 'private, max-age=3600',
        },
      })
    } catch (e) {
      console.error('[voip-recording] proxy CDN Sonax falhou:', e)
      return error('Falha ao buscar gravação no CDN', 502)
    }
  } catch (e) {
    return handleError(e)
  }
}
