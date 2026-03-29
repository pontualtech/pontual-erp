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

    // Busca avisos ativos com require_read que o usuário ainda não leu
    const announcements = await prisma.announcement.findMany({
      where: {
        company_id: user.companyId,
        require_read: true,
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
    return handleError(err)
  }
}
