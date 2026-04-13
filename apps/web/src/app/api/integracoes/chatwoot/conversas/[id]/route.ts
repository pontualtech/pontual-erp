import { NextRequest, NextResponse } from 'next/server'
import { getMessages, sendMessage, isChatwootConfigured } from '@/lib/chatwoot'
import { error, handleError } from '@/lib/api-response'
import { getServerUser } from '@/lib/auth'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await getServerUser()
    if (!user) return error('Nao autenticado', 401)

    if (!isChatwootConfigured()) {
      return error('Chatwoot nao configurado', 503)
    }

    const conversationId = Number(params.id)
    if (!conversationId) return error('ID invalido', 400)

    const result = await getMessages(conversationId)
    const messages = (result?.payload || []).map((m: any) => ({
      id: m.id,
      content: m.content,
      message_type: m.message_type === 0 ? 'incoming' : m.message_type === 1 ? 'outgoing' : 'activity',
      sender_name: m.sender?.name || '',
      sender_type: m.sender_type,
      created_at: m.created_at,
      content_type: m.content_type,
      attachments: m.attachments || [],
    }))

    return NextResponse.json({ data: messages })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const postUser = await getServerUser()
    if (!postUser) return error('Nao autenticado', 401)

    if (!isChatwootConfigured()) {
      return error('Chatwoot nao configurado', 503)
    }

    const conversationId = Number(params.id)
    if (!conversationId) return error('ID invalido', 400)

    const { message } = await req.json()
    if (!message?.trim()) return error('Mensagem e obrigatoria', 400)

    const result = await sendMessage(conversationId, message)
    return NextResponse.json({ data: result })
  } catch (err) {
    return handleError(err)
  }
}
