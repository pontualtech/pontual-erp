import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    if (!['admin', 'owner'].includes(user.roleName)) {
      return error('Apenas administradores podem editar avisos', 403)
    }

    const existing = await prisma.announcement.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Aviso nao encontrado', 404)

    const body = await req.json()

    const data: any = {}
    if (body.title !== undefined) data.title = body.title.trim()
    if (body.message !== undefined) data.message = body.message.trim()
    if (body.priority !== undefined) data.priority = body.priority
    if (body.pinned !== undefined) data.pinned = body.pinned
    if (body.expires_at !== undefined) data.expires_at = body.expires_at ? new Date(body.expires_at) : null

    const announcement = await prisma.announcement.update({
      where: { id: params.id },
      data,
    })

    return success(announcement)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    if (!['admin', 'owner'].includes(user.roleName)) {
      return error('Apenas administradores podem remover avisos', 403)
    }

    const existing = await prisma.announcement.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Aviso nao encontrado', 404)

    await prisma.announcement.delete({
      where: { id: params.id },
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
