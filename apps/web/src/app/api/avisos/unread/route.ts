import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/** Retorna avisos não lidos que exigem confirmação de leitura */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Busca TODOS os avisos ativos nao lidos (require_read ou nao)
    // O frontend separa: modal mostra require_read, bell mostra o resto
    const announcements = await prisma.announcement.findMany({
      where: {
        company_id: user.companyId,
        OR: [
          { expires_at: null },
          { expires_at: { gt: new Date() } },
        ],
        reads: {
          none: {
            user_id: user.id,
          },
        },
      },
      orderBy: [
        { pinned: 'desc' },
        { created_at: 'desc' },
      ],
    })

    return success({
      count: announcements.length,
      announcements,
    })
  } catch (err) {
    // Fallback para evitar 503 intermitente — retorna lista vazia em caso de erro de DB
    console.error('[avisos/unread] Error:', err)
    try {
      return handleError(err)
    } catch {
      return NextResponse.json({ data: { count: 0, announcements: [] } })
    }
  }
}
