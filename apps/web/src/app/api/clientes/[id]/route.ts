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

    // IDOR protection: motorista only gets limited fields (logistics-relevant data)
    if (user.roleName === 'motorista') {
      return success({
        id: customer.id,
        legal_name: customer.legal_name,
        trade_name: customer.trade_name,
        phone: customer.phone,
        mobile: customer.mobile,
        address_street: customer.address_street,
        address_number: customer.address_number,
        address_complement: customer.address_complement,
        address_neighborhood: customer.address_neighborhood,
        address_city: customer.address_city,
        address_state: customer.address_state,
        address_zip: customer.address_zip,
      })
    }

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

    await prisma.customer.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: validatedData as any,
    })
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'clientes',
      action: 'update',
      entityId: customer!.id,
      oldValue: existing as any,
      newValue: validatedData,
    })

    return success(customer!)
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

    await prisma.customer.updateMany({
      where: { id: params.id, company_id: user.companyId },
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
