import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { paginated, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    if (!user.isSuperAdmin && user.roleName !== 'admin' && user.roleName !== 'administrador') {
      return NextResponse.json({ error: 'Acesso negado — apenas admin' }, { status: 403 })
    }

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '50')))
    const search = (url.get('search') || '').trim()
    // Bloco 3 — 3 modos de filtro por tags combinados:
    //   tags     = AND (hasEvery — todas presentes)
    //   tagsAny  = OR  (hasSome  — pelo menos uma)
    //   tagsNot  = NOT (NOT hasSome — nenhuma)
    // Backward compat: `tags=` continua funcionando como AND (era o único modo antes).
    const parseTags = (p: string) => (p ? p.split(',').map(s => s.trim()).filter(Boolean) : [])
    const tagsAll = parseTags(url.get('tags') || '')
    const tagsAny = parseTags(url.get('tagsAny') || '')
    const tagsNot = parseTags(url.get('tagsNot') || '')
    const unsubscribed = url.get('unsubscribed')
    const onlyBounced = url.get('onlyBounced') === '1'

    const where: any = { company_id: user.companyId }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ]
    }

    // tags AND: todas precisam estar
    if (tagsAll.length > 0) {
      where.tags = { ...(where.tags || {}), hasEvery: tagsAll }
    }
    // tagsAny OR: pelo menos uma
    if (tagsAny.length > 0) {
      where.tags = { ...(where.tags || {}), hasSome: tagsAny }
    }
    // tagsNot: nenhuma das listadas
    if (tagsNot.length > 0) {
      where.NOT = { ...(where.NOT || {}), tags: { hasSome: tagsNot } }
    }

    if (unsubscribed === 'true') where.unsubscribed = true
    if (unsubscribed === 'false') where.unsubscribed = false
    if (onlyBounced) where.bounce_count = { gt: 0 }

    const [total, rows] = await Promise.all([
      prisma.marketingContact.count({ where }),
      prisma.marketingContact.findMany({
        where,
        orderBy: [{ last_seen_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          origin: true,
          tags: true,
          customer_id: true,
          unsubscribed: true,
          bounce_count: true,
          last_sent_at: true,
          last_opened_at: true,
          last_clicked_at: true,
          last_seen_at: true,
          created_at: true,
        },
      }),
    ])

    return paginated(rows, total, page, limit)
  } catch (e) {
    return handleError(e)
  }
}
