import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    const contact = await prisma.marketingContact.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!contact) return error('Contato não encontrado', 404)

    const limit = Math.min(200, Math.max(10, Number(req.nextUrl.searchParams.get('limit') || '50')))

    // Eventos do webhook por email (índice idx_mwe_email)
    const events = await prisma.marketingWebhookEvent.findMany({
      where: { company_id: user.companyId, email: contact.email },
      orderBy: { received_at: 'desc' },
      take: limit,
      select: {
        id: true,
        event_type: true,
        received_at: true,
        status: true,
        raw_payload: true,
      },
    })

    const customer = contact.customer_id
      ? await prisma.customer.findFirst({
          where: { id: contact.customer_id, company_id: user.companyId },
          select: { id: true, legal_name: true, trade_name: true, person_type: true, document_number: true, address_city: true, address_state: true, total_os: true, last_os_at: true },
        })
      : null

    const stats = {
      total_events: events.length,
      sent: events.filter(e => e.event_type === 'email.sent').length,
      delivered: events.filter(e => e.event_type === 'email.delivered').length,
      opened: events.filter(e => e.event_type === 'email.opened').length,
      clicked: events.filter(e => e.event_type === 'email.clicked').length,
      bounced: events.filter(e => e.event_type === 'email.bounced').length,
      complained: events.filter(e => e.event_type === 'email.complained').length,
      unsubscribed: events.filter(e => e.event_type === 'email.unsubscribed').length,
    }

    return success({ contact, customer, events, stats })
  } catch (e) {
    return handleError(e)
  }
}
