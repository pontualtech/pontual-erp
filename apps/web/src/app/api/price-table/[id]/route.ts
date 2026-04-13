import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.priceTable.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Entrada nao encontrada', 404)

    const body = await req.json()

    await prisma.priceTable.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: {
        equipment_type: body.equipment_type !== undefined ? (body.equipment_type || null) : undefined,
        brand: body.brand !== undefined ? (body.brand || null) : undefined,
        model_pattern: body.model_pattern !== undefined ? (body.model_pattern || null) : undefined,
        service_description: body.service_description !== undefined ? (body.service_description || null) : undefined,
        default_price: typeof body.default_price === 'number' ? body.default_price : undefined,
        estimated_time_minutes: body.estimated_time_minutes !== undefined
          ? (typeof body.estimated_time_minutes === 'number' ? body.estimated_time_minutes : null)
          : undefined,
        is_active: body.is_active !== undefined ? body.is_active : undefined,
      },
    })
    const updated = await prisma.priceTable.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    return success(updated!)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.priceTable.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Entrada nao encontrada', 404)

    await prisma.priceTable.deleteMany({ where: { id: params.id, company_id: user.companyId } })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
