import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { updateCustomerSchema, normalizeDocument } from '@/lib/validations/clientes'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('clientes', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const customer = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        service_orders: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
          take: 10,
          include: {
            module_statuses: { select: { name: true, color: true } },
          },
        },
      },
    })

    if (!customer) return error('Cliente não encontrado', 404)
    return success(customer)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return PUT(req, { params })
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('clientes', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Cliente não encontrado', 404)

    const body = await req.json()
    // Validar com Zod strict — rejeita campos não permitidos
    const validatedData = updateCustomerSchema.parse(body)

    const customer = await prisma.customer.update({
      where: { id: params.id },
      data: validatedData as any,
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'clientes',
      action: 'update',
      entityId: customer.id,
      oldValue: existing as any,
      newValue: validatedData,
    })

    return success(customer)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('clientes', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Cliente não encontrado', 404)

    await prisma.customer.update({
      where: { id: params.id },
      data: { deleted_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'clientes',
      action: 'delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
