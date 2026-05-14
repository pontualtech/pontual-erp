import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

interface CampaignRow {
  campaign: string
  sent: bigint
  delivered: bigint
  opened: bigint
  clicked: bigint
  bounced: bigint
  complained: bigint
  unique_emails: bigint
  first_at: Date
  last_at: Date
}

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
    }

    // Agrega eventos webhook por campaign tag.
    // Resend envia tags como objeto plano: {campaign: 'X', segment: 'Y'}.
    // Filtra out '(sem campaign)' pra mostrar só campanhas reais nomeadas.
    const rows = await prisma.$queryRaw<CampaignRow[]>`
      SELECT
        coalesce(raw_payload->'data'->'tags'->>'campaign', '(sem campaign)') as campaign,
        count(*) FILTER (WHERE event_type='email.sent')      as sent,
        count(*) FILTER (WHERE event_type='email.delivered') as delivered,
        count(*) FILTER (WHERE event_type='email.opened')    as opened,
        count(*) FILTER (WHERE event_type='email.clicked')   as clicked,
        count(*) FILTER (WHERE event_type='email.bounced')   as bounced,
        count(*) FILTER (WHERE event_type='email.complained') as complained,
        count(DISTINCT email) as unique_emails,
        min(received_at) as first_at,
        max(received_at) as last_at
      FROM marketing_webhook_event
      WHERE company_id = ${user.companyId}
      GROUP BY campaign
      ORDER BY max(received_at) DESC
      LIMIT 100
    `

    // Convert bigint → number e calcula taxas
    const campaigns = rows.map(r => {
      const sent = Number(r.sent)
      const delivered = Number(r.delivered)
      const opened = Number(r.opened)
      const clicked = Number(r.clicked)
      const bounced = Number(r.bounced)
      return {
        campaign: r.campaign,
        sent,
        delivered,
        opened,
        clicked,
        bounced,
        complained: Number(r.complained),
        unique_emails: Number(r.unique_emails),
        first_at: r.first_at,
        last_at: r.last_at,
        rates: {
          delivery: sent > 0 ? Number((delivered / sent * 100).toFixed(1)) : 0,
          open: delivered > 0 ? Number((opened / delivered * 100).toFixed(1)) : 0,
          click: delivered > 0 ? Number((clicked / delivered * 100).toFixed(1)) : 0,
          bounce: sent > 0 ? Number((bounced / sent * 100).toFixed(1)) : 0,
        },
      }
    })

    return success({ campaigns, total: campaigns.length })
  } catch (e) {
    return handleError(e)
  }
}
