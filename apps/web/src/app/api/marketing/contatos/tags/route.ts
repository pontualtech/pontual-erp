/**
 * Lista distinct de tags do tenant — alimenta autocomplete do TagFilterChips.
 *
 * GET /api/marketing/contatos/tags?prefix=<str>
 *
 * - Sem prefix: retorna até 200 tags mais frequentes
 * - Com prefix: filtra por LIKE (ex: prefix=year: → year:2020, year:2021, ...)
 *
 * Multi-tenant: company_id obrigatório.
 *
 * Performance: raw SQL com `unnest(tags)` + GROUP BY. PostgreSQL gerencia
 * isso bem mesmo com 13k+ contatos (~30ms). Sem cache por enquanto — se
 * virar gargalo, agregar em coluna materializada ou Redis.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

    const url = req.nextUrl.searchParams
    const prefix = (url.get('prefix') || '').trim()
    const limit = Math.min(500, Math.max(1, Number(url.get('limit') || '200')))

    // Unnest array de tags e conta frequência. Ordena por freq desc.
    // Prepared statement seguro contra injection: $1 é o companyId, $2 é o prefix LIKE.
    type Row = { tag: string; count: bigint }
    const rows = prefix
      ? await prisma.$queryRaw<Row[]>`
          SELECT tag, COUNT(*)::bigint AS count
          FROM marketing_contacts c, unnest(c.tags) AS tag
          WHERE c.company_id = ${user.companyId}
            AND tag ILIKE ${prefix + '%'}
          GROUP BY tag
          ORDER BY count DESC, tag ASC
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<Row[]>`
          SELECT tag, COUNT(*)::bigint AS count
          FROM marketing_contacts c, unnest(c.tags) AS tag
          WHERE c.company_id = ${user.companyId}
          GROUP BY tag
          ORDER BY count DESC, tag ASC
          LIMIT ${limit}
        `

    const tags = rows.map(r => ({ tag: r.tag, count: Number(r.count) }))
    return success({ tags, total: tags.length })
  } catch (e) {
    return handleError(e)
  }
}
