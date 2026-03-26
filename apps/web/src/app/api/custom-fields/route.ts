import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { createCustomFieldSchema, moduleFilterSchema } from '@pontual/utils/validation'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const params = Object.fromEntries(request.nextUrl.searchParams)
    const { module } = moduleFilterSchema.parse(params)

    const fields = await prisma.customField.findMany({
      where: { company_id: user.companyId, module, is_active: true },
      orderBy: { order: 'asc' },
    })

    return success(fields)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('core', 'edit')
    if (result instanceof NextResponse) return result
    const admin = result

    const body = await request.json()
    const data = createCustomFieldSchema.parse(body)

    // Verificar duplicata
    const existing = await prisma.customField.findFirst({
      where: {
        company_id: admin.companyId,
        module: data.module,
        field_name: data.fieldName,
      },
    })
    if (existing) return error('Campo customizado já existe neste módulo', 409)

    // Calcular próxima ordem se não informada
    let order = data.order
    if (order === undefined) {
      const last = await prisma.customField.findFirst({
        where: { company_id: admin.companyId, module: data.module },
        orderBy: { order: 'desc' },
        select: { order: true },
      })
      order = (last?.order ?? -1) + 1
    }

    const field = await prisma.customField.create({
      data: {
        company_id: admin.companyId,
        module: data.module,
        field_name: data.fieldName,
        field_label: data.fieldLabel,
        field_type: data.fieldType,
        required: data.required,
        options: data.options ?? undefined,
        defaultVal: data.defaultValue,
        order,
      },
    })

    logAudit({
      companyId: admin.companyId,
      userId: admin.id,
      module: 'core',
      action: 'create_custom_field',
      entityId: field.id,
      newValue: { module: data.module, fieldName: data.fieldName, fieldType: data.fieldType },
    })

    return success(field, 201)
  } catch (err) {
    return handleError(err)
  }
}
