import { NextRequest, NextResponse } from 'next/server'
import { listConversations, isChatwootConfigured } from '@/lib/chatwoot'
import { error, handleError } from '@/lib/api-response'
import { getServerUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser()
    if (!user) return error('Nao autenticado', 401)

    if (!isChatwootConfigured()) {
      return error('Chatwoot nao configurado (CHATWOOT_API_TOKEN ausente)', 503)
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || undefined
    const inboxId = searchParams.get('inbox_id')
      ? Number(searchParams.get('inbox_id'))
      : undefined
    const page = searchParams.get('page')
      ? Number(searchParams.get('page'))
      : undefined

    const result: any = await listConversations(status, inboxId, page)

    // Simplify response
    const payload = result?.data?.payload || result?.payload || []
    const meta = result?.data?.meta || result?.meta || {}

    const conversations = (Array.isArray(payload) ? payload : []).map((c: any) => ({
      id: c.id,
      contact_name: c.meta?.sender?.name || c.contact?.name || 'Desconhecido',
      contact_phone: c.meta?.sender?.phone_number || c.contact?.phone_number || '',
      last_message: c.last_non_activity_message?.content || c.messages?.[0]?.content || '',
      status: c.status,
      inbox_id: c.inbox_id,
      inbox_name:
        c.inbox_id === 4
          ? 'Vendas WhatsApp'
          : c.inbox_id === 3
          ? 'Suporte Pontualtech'
          : c.inbox_id === 7
          ? 'Pontualtech Assistencia'
          : `Inbox ${c.inbox_id}`,
      created_at: c.created_at,
      updated_at: c.last_activity_at || c.updated_at,
    }))

    return NextResponse.json({
      data: conversations,
      meta,
    })
  } catch (err) {
    return handleError(err)
  }
}
