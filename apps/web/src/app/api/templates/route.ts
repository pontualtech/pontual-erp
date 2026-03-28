import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')

    const where: Record<string, unknown> = { company_id: user.companyId }
    if (type) where.type = type

    const templates = await prisma.printTemplate.findMany({
      where,
      orderBy: [{ type: 'asc' }, { is_default: 'desc' }, { name: 'asc' }],
    })

    return success(templates)
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
    const { type, name, html_template, css_override, is_default } = body

    if (!type || !name || !html_template) {
      return error('type, name e html_template são obrigatórios', 400)
    }

    // If setting as default, unset other defaults of same type
    if (is_default) {
      await prisma.printTemplate.updateMany({
        where: { company_id: user.companyId, type, is_default: true },
        data: { is_default: false },
      })
    }

    const template = await prisma.printTemplate.create({
      data: {
        company_id: user.companyId,
        type,
        name,
        html_template,
        css_override: css_override || null,
        is_default: is_default ?? false,
        is_active: true,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'config',
      action: 'create_template',
      entityId: template.id,
      newValue: { type, name, is_default },
    })

    return success(template, 201)
  } catch (err) {
    return handleError(err)
  }
}
