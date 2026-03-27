import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.setting.findFirst({
      where: { id: params.id, company_id: user.companyId, key: { startsWith: 'forma_pgto.' } },
    })
    if (!existing) return error('Forma de pagamento não encontrada', 404)

    const body = await req.json()
    const current = JSON.parse(existing.value)
    const updated = { ...current, ...body }

    await prisma.setting.update({
      where: { id: params.id },
      data: { value: JSON.stringify(updated) },
    })

    return success({ id: params.id, ...updated })
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.setting.findFirst({
      where: { id: params.id, company_id: user.companyId, key: { startsWith: 'forma_pgto.' } },
    })
    if (!existing) return error('Forma de pagamento não encontrada', 404)

    await prisma.setting.delete({ where: { id: params.id } })
    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
