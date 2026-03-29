import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

/** Registra confirmação de leitura de um aviso */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Verifica se o aviso existe e pertence à empresa
    const announcement = await prisma.announcement.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!announcement) return error('Aviso nao encontrado', 404)

    // Upsert — não falha se já lido
    const read = await prisma.announcementRead.upsert({
      where: {
        announcement_id_user_id: {
          announcement_id: params.id,
          user_id: user.id,
        },
      },
      update: {},
      create: {
        announcement_id: params.id,
        user_id: user.id,
        company_id: user.companyId,
      },
    })

    // Registra no audit trail
    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'avisos',
      action: 'read_confirmation',
      entityId: params.id,
    })

    return success({ read_at: read.read_at })
  } catch (err) {
    return handleError(err)
  }
}
