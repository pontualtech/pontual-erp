import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * Lista contatos marketing que abriram/clicaram em email recentemente.
 *
 * Karlão: "quem chamou pelo email" — quem está engajando com campanhas Mautic/Resend.
 * Data source: marketing_contacts (populada via webhook Resend/Mautic).
 *
 * Fields:
 *  - last_opened_at = última abertura registrada
 *  - last_clicked_at = último click em link de email
 *
 * Query: contatos com pelo menos uma dessas timestamps nas últimas 24h/7d.
 */

const WINDOWS_HOURS: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 }

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cId = user.companyId
    const windowKey = req.nextUrl.searchParams.get('window') || '7d'
    const hours = WINDOWS_HOURS[windowKey] ?? 168
    const since = new Date(Date.now() - hours * 3600 * 1000)

    const contacts = await prisma.marketingContact.findMany({
      where: {
        company_id: cId,
        OR: [
          { last_clicked_at: { gte: since } },
          { last_opened_at: { gte: since } },
        ],
        unsubscribed: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        tags: true,
        last_opened_at: true,
        last_clicked_at: true,
        customer_id: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: [
        { last_clicked_at: { sort: 'desc', nulls: 'last' } },
        { last_opened_at: { sort: 'desc', nulls: 'last' } },
      ],
      take: 25,
    })

    const items = contacts.map(c => ({
      id: c.id,
      name: c.name || c.customer?.name || c.email.split('@')[0],
      email: c.email,
      phone: c.phone,
      tags: c.tags || [],
      last_opened_at: c.last_opened_at?.toISOString() || null,
      last_clicked_at: c.last_clicked_at?.toISOString() || null,
      action: c.last_clicked_at && (!c.last_opened_at || c.last_clicked_at >= c.last_opened_at)
        ? 'clicked'
        : 'opened',
      customer_id: c.customer_id || null,
      customer_name: c.customer?.name || null,
    }))

    const counts = {
      total: items.length,
      clicked: items.filter(i => i.action === 'clicked').length,
      opened_only: items.filter(i => i.action === 'opened').length,
    }

    return success({
      window: windowKey,
      since: since.toISOString(),
      counts,
      items,
    })
  } catch (e) {
    return handleError(e)
  }
}
