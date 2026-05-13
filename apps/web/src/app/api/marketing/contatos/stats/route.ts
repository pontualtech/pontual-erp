import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const cId = user.companyId

    const [total, unsub, bounced, b2c, b2b, atendido, lead, emServico, perdido] = await Promise.all([
      prisma.marketingContact.count({ where: { company_id: cId } }),
      prisma.marketingContact.count({ where: { company_id: cId, unsubscribed: true } }),
      prisma.marketingContact.count({ where: { company_id: cId, bounce_count: { gt: 0 } } }),
      prisma.marketingContact.count({ where: { company_id: cId, tags: { has: 'segment:b2c' } } }),
      prisma.marketingContact.count({ where: { company_id: cId, tags: { has: 'segment:b2b' } } }),
      prisma.marketingContact.count({ where: { company_id: cId, tags: { has: 'stage:cliente_atendido' } } }),
      prisma.marketingContact.count({ where: { company_id: cId, tags: { has: 'stage:lead_aguardando' } } }),
      prisma.marketingContact.count({ where: { company_id: cId, tags: { has: 'stage:cliente_em_servico' } } }),
      prisma.marketingContact.count({ where: { company_id: cId, tags: { has: 'stage:perdido_recusou' } } }),
    ])

    return success({
      total,
      unsubscribed: unsub,
      bounced,
      segments: { b2c, b2b },
      stages: {
        cliente_atendido: atendido,
        lead_aguardando: lead,
        cliente_em_servico: emServico,
        perdido_recusou: perdido,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
