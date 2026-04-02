import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const channel = req.nextUrl.searchParams.get('channel') || 'geral'

    const messages = await prisma.chatMessage.findMany({
      where: {
        company_id: user.companyId,
        channel,
      },
      orderBy: { created_at: 'asc' },
      take: 50,
    })

    return success(messages)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Motorista não pode enviar mensagens no chat interno
    if (user.roleName === 'motorista') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
    }

    const body = await req.json()

    if (!body.message?.trim()) return error('Mensagem e obrigatoria')

    const message = await prisma.chatMessage.create({
      data: {
        company_id: user.companyId,
        sender_id: user.id,
        sender_name: user.name,
        message: body.message.trim(),
        channel: body.channel || 'geral',
      },
    })

    return success(message, 201)
  } catch (err) {
    return handleError(err)
  }
}
