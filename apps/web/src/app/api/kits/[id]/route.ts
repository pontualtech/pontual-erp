import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof Response) return result
    const user = result

    const setting = await prisma.setting.findFirst({
      where: { id: params.id, company_id: user.companyId, key: { startsWith: 'kit.' } },
    })
    if (!setting) return error('Kit nao encontrado', 404)

    const body = await req.json()
    const { name, items } = body

    if (!name?.trim()) return error('Nome do kit e obrigatorio')
    if (!items || !Array.isArray(items) || items.length === 0) return error('Kit deve ter pelo menos um item')

    for (const item of items) {
      if (!item.description?.trim()) return error('Todos os itens precisam de descricao')
      if (typeof item.unit_price !== 'number' || item.unit_price < 0) return error('Preco invalido em um dos itens')
    }

    const updated = await prisma.setting.update({
      where: { id: params.id },
      data: {
        value: JSON.stringify({ name: name.trim(), items }),
        updated_at: new Date(),
      },
    })

    return success({
      id: updated.id,
      key: updated.key,
      value: { name: name.trim(), items },
      updated_at: updated.updated_at,
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof Response) return result
    const user = result

    const setting = await prisma.setting.findFirst({
      where: { id: params.id, company_id: user.companyId, key: { startsWith: 'kit.' } },
    })
    if (!setting) return error('Kit nao encontrado', 404)

    await prisma.setting.delete({ where: { id: params.id } })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
