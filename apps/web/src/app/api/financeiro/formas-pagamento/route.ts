import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

const KEY_PREFIX = 'forma_pgto.'

export async function GET() {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { startsWith: KEY_PREFIX } },
      orderBy: { key: 'asc' },
    })

    const items = settings.map(s => {
      const parsed = JSON.parse(s.value)
      return { id: s.id, ...parsed }
    })

    return success(items)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    if (!body.name?.trim()) return error('Nome é obrigatório', 400)

    const setting = await prisma.setting.create({
      data: {
        company_id: user.companyId,
        key: `${KEY_PREFIX}${crypto.randomUUID()}`,
        value: JSON.stringify({
          name: body.name.trim(),
          icon: body.icon || '💰',
          active: body.active !== false,
        }),
        type: 'json',
      },
    })

    return success({ id: setting.id, name: body.name.trim(), icon: body.icon || '💰', active: true }, 201)
  } catch (err) {
    return handleError(err)
  }
}
