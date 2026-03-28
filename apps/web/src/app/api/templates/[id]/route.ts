import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const template = await prisma.printTemplate.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    if (!template) return error('Template não encontrado', 404)
    return success(template)
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.printTemplate.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Template não encontrado', 404)

    const body = await req.json()
    const { name, html_template, css_override, is_default, is_active } = body

    // If setting as default, unset other defaults of same type
    if (is_default && !existing.is_default) {
      await prisma.printTemplate.updateMany({
        where: { company_id: user.companyId, type: existing.type, is_default: true },
        data: { is_default: false },
      })
    }

    const template = await prisma.printTemplate.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(html_template !== undefined && { html_template }),
        ...(css_override !== undefined && { css_override }),
        ...(is_default !== undefined && { is_default }),
        ...(is_active !== undefined && { is_active }),
        updated_at: new Date(),
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'config',
      action: 'update_template',
      entityId: template.id,
      oldValue: { name: existing.name, is_default: existing.is_default },
      newValue: { name: template.name, is_default: template.is_default },
    })

    return success(template)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.printTemplate.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Template não encontrado', 404)

    if (existing.is_default) {
      return error('Não é possível excluir o template padrão. Defina outro como padrão primeiro.', 400)
    }

    await prisma.printTemplate.delete({
      where: { id: params.id },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'config',
      action: 'delete_template',
      entityId: params.id,
      oldValue: { name: existing.name, type: existing.type },
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
