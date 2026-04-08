import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const sessions = await prisma.aiChatSession.findMany({
      where: {
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
      },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        created_at: true,
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { content: true, created_at: true },
        },
      },
    })

    return NextResponse.json({
      data: sessions.map(s => ({
        id: s.id,
        title: s.title,
        last_message: s.messages[0]?.content?.slice(0, 100) || null,
        created_at: s.created_at,
      })),
    })
  } catch (err) {
    console.error('[Portal AI Sessions Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
