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

    const existing = await prisma.moduleStatus.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Status não encontrado', 404)

    const body = await req.json()
    delete body.company_id
    delete body.id

    const status = await prisma.moduleStatus.update({
      where: { id: params.id },
      data: body,
    })

    return success(status)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.moduleStatus.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { _count: { select: { service_orders: true } } },
    })
    if (!existing) return error('Status não encontrado', 404)

    if (existing._count.service_orders > 0) {
      return error(`Este status possui ${existing._count.service_orders} OS vinculadas. Mova-as primeiro.`, 400)
    }

    if (existing.is_default) {
      return error('Não é possível excluir o status padrão', 400)
    }

    await prisma.moduleStatus.delete({ where: { id: params.id } })
    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
