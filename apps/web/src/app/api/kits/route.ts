import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof Response) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: {
        company_id: user.companyId,
        key: { startsWith: 'kit.' },
      },
      orderBy: { created_at: 'desc' },
    })

    const kits = settings.map(s => ({
      id: s.id,
      key: s.key,
      value: (() => { try { return JSON.parse(s.value) } catch { return s.value } })(),
      created_at: s.created_at,
    }))

    return success(kits)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof Response) return result
    const user = result

    const body = await req.json()
    const { name, items } = body

    if (!name?.trim()) return error('Nome do kit e obrigatorio')
    if (!items || !Array.isArray(items) || items.length === 0) return error('Kit deve ter pelo menos um item')

    // Validate items
    for (const item of items) {
      if (!item.description?.trim()) return error('Todos os itens precisam de descricao')
      if (typeof item.unit_price !== 'number' || item.unit_price < 0) return error('Preco invalido em um dos itens')
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const timestamp = Date.now()
    const key = `kit.${slug}_${timestamp}`

    const setting = await prisma.setting.create({
      data: {
        company_id: user.companyId,
        key,
        value: JSON.stringify({ name: name.trim(), items }),
        type: 'json',
      },
    })

    return success({
      id: setting.id,
      key: setting.key,
      value: { name: name.trim(), items },
      created_at: setting.created_at,
    }, 201)
  } catch (err) {
    return handleError(err)
  }
}
