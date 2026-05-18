/**
 * Marketing Global Search — Cmd+K spotlight.
 *
 * GET /api/marketing/search?q=<term>&limit=<n>
 *
 * Pesquisa em paralelo 4 entidades do módulo Marketing:
 * - contacts: por email/name/phone (case-insensitive, contains)
 * - segments: por name
 * - campaigns: por tag do payload Resend (campaign=X)
 * - automations: por name
 *
 * Limite default 5 por entidade, max 15. Todas queries filtram por
 * company_id (multi-tenant). Termo precisa de min 2 chars.
 *
 * Retorno: { contacts[], segments[], campaigns[], automations[], total }
 * Cada item tem { id, label, sublabel?, href, icon }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ResultItem {
  id: string
  label: string
  sublabel?: string
  href: string
  icon: string
}

interface SearchResults {
  contacts: ResultItem[]
  segments: ResultItem[]
  campaigns: ResultItem[]
  automations: ResultItem[]
  total: number
}

function ensureAdmin(user: { isSuperAdmin: boolean; roleName: string }) {
  if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }
  return null
}

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const denied = ensureAdmin(user); if (denied) return denied

    const url = new URL(req.url)
    const q = (url.searchParams.get('q') || '').trim()
    const limit = Math.min(15, Math.max(1, parseInt(url.searchParams.get('limit') || '5')))

    if (q.length < 2) {
      const empty: SearchResults = { contacts: [], segments: [], campaigns: [], automations: [], total: 0 }
      return success(empty)
    }

    // Roda as 4 queries em paralelo — todas escopadas por company_id
    const [contacts, segments, campaigns, automations] = await Promise.all([
      prisma.marketingContact.findMany({
        where: {
          company_id: user.companyId,
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        },
        select: { id: true, email: true, name: true, phone: true },
        take: limit,
      }),
      prisma.marketingSegment.findMany({
        where: {
          company_id: user.companyId,
          name: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, name: true, description: true, contact_count: true },
        take: limit,
      }),
      // Campanhas = grupo de webhook events com tag campaign=X — agrupado por valor
      prisma.$queryRaw<Array<{ campaign: string; total: bigint }>>`
        SELECT DISTINCT
          (payload -> 'data' -> 'tags' -> 'campaign')::text AS campaign,
          COUNT(*) AS total
        FROM marketing_webhook_event
        WHERE company_id = ${user.companyId}
          AND payload -> 'data' -> 'tags' ->> 'campaign' ILIKE ${'%' + q + '%'}
        GROUP BY campaign
        ORDER BY MAX(created_at) DESC
        LIMIT ${limit}
      `.catch(() => [] as Array<{ campaign: string; total: bigint }>),
      prisma.marketingStageAutomation.findMany({
        where: {
          company_id: user.companyId,
          name: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, name: true, action_type: true, active: true },
        take: limit,
      }),
    ])

    const results: SearchResults = {
      contacts: contacts.map(c => ({
        id: c.id,
        label: c.name || c.email,
        sublabel: c.name ? c.email : (c.phone || undefined),
        href: `/marketing/contatos/${c.id}`,
        icon: 'user',
      })),
      segments: segments.map(s => ({
        id: s.id,
        label: s.name,
        sublabel: s.contact_count != null ? `${s.contact_count} contatos` : s.description || undefined,
        href: `/marketing/segmentos/${s.id}`,
        icon: 'file-text',
      })),
      campaigns: campaigns.map(c => ({
        id: c.campaign,
        label: c.campaign.replace(/^"|"$/g, ''),
        sublabel: `${c.total} eventos`,
        href: `/marketing/campanhas?campaign=${encodeURIComponent(c.campaign.replace(/^"|"$/g, ''))}`,
        icon: 'megaphone',
      })),
      automations: automations.map(a => ({
        id: a.id,
        label: a.name,
        sublabel: `${a.action_type}${a.active ? '' : ' · pausada'}`,
        href: `/marketing/automations`,
        icon: 'zap',
      })),
      total: 0,
    }
    results.total = results.contacts.length + results.segments.length + results.campaigns.length + results.automations.length

    return success(results)
  } catch (e) {
    return handleError(e)
  }
}
