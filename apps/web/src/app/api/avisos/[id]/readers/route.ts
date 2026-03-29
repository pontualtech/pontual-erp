import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

/** Retorna quem leu e quem nao leu o aviso (apenas admin) */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    if (!['admin', 'owner'].includes(user.roleName)) {
      return error('Apenas administradores podem ver leitores', 403)
    }

    const announcement = await prisma.announcement.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!announcement) return error('Aviso nao encontrado', 404)

    // Busca registros de leitura
    const reads = await prisma.announcementRead.findMany({
      where: {
        announcement_id: params.id,
        company_id: user.companyId,
      },
      orderBy: { read_at: 'asc' },
    })

    // Busca todos os usuarios ativos da empresa
    const allUsers = await prisma.userProfile.findMany({
      where: { company_id: user.companyId, is_active: true },
      select: { id: true, name: true, email: true },
    })

    // Mapear user_id -> user info
    const userMap = new Map(allUsers.map(u => [u.id, u]))
    const readUserIds = new Set(reads.map(r => r.user_id))

    const readBy = reads
      .map(r => {
        const u = userMap.get(r.user_id)
        return {
          user_id: r.user_id,
          name: u?.name || 'Usuario removido',
          email: u?.email || '',
          read_at: r.read_at,
        }
      })

    const notReadBy = allUsers
      .filter(u => !readUserIds.has(u.id))
      .map(u => ({
        user_id: u.id,
        name: u.name,
        email: u.email,
      }))

    return success({
      total_users: allUsers.length,
      read_count: readBy.length,
      not_read_count: notReadBy.length,
      read_by: readBy,
      not_read_by: notReadBy,
    })
  } catch (err) {
    return handleError(err)
  }
}
