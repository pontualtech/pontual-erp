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

    // Se ainda não baixou, baixa agora (síncrono — pode levar alguns segundos)
    let localPath = call.recording_path
    if (!localPath) {
      const result = await downloadRecording({
        recordingUrl: call.recording_url,
        companyId: call.company_id,
        callId: call.call_id,
        startedAt: call.started_at,
      })

      if (!result.ok || !result.localPath) {
        // Fallback: redireciona pro CDN Sonax (pode estar protegido por token mas vale tentar)
        return NextResponse.redirect(call.recording_url)
      }

      localPath = result.localPath
      // Persiste o path no DB pra próximas requests
      await prisma.voipCall.update({
        where: { id: call.id },
        data: {
          recording_path: result.localPath,
          recording_size_kb: result.sizeBytes ? Math.round(result.sizeBytes / 1024) : undefined,
        },
      }).catch(() => {})
    }

    const buffer = await readRecording(localPath)
    if (!buffer) return error('Arquivo de gravação não encontrado', 404)

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="call-${call.call_id}.mp3"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
