import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('contratos', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const contract = await prisma.contract.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        customers: { select: { id: true, legal_name: true, phone: true, email: true, document_number: true, address_street: true, address_number: true, address_city: true, address_state: true } },
        contract_equipment: { orderBy: { created_at: 'asc' } },
        contract_visits: { orderBy: { visit_date: 'desc' } },
      },
    })

    if (!contract) return error('Contrato não encontrado', 404)

    return success(contract)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('contratos', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.contract.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Contrato não encontrado', 404)

    const body = await req.json()

    const updateData: any = { updated_at: new Date() }
    if (body.number !== undefined) updateData.number = body.number
    if (body.description !== undefined) updateData.description = body.description
    if (body.start_date) updateData.start_date = new Date(body.start_date)
    if (body.end_date) updateData.end_date = new Date(body.end_date)
    if (body.monthly_value !== undefined) updateData.monthly_value = body.monthly_value
    if (body.billing_day !== undefined) updateData.billing_day = body.billing_day
    if (body.visit_frequency) updateData.visit_frequency = body.visit_frequency
    if (body.max_visits_per_period !== undefined) updateData.max_visits_per_period = body.max_visits_per_period
    if (body.status) updateData.status = body.status
    if (body.auto_renew !== undefined) updateData.auto_renew = body.auto_renew
    if (body.renewal_alert_days !== undefined) updateData.renewal_alert_days = body.renewal_alert_days
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.customer_id) updateData.customer_id = body.customer_id

    await prisma.contract.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: updateData,
    })
    const updated = await prisma.contract.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        customers: { select: { id: true, legal_name: true } },
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'contratos',
      action: 'update',
      entityId: params.id,
      oldValue: { status: existing.status },
      newValue: { status: updated!.status },
    })

    return success(updated!)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('contratos', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.contract.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Contrato não encontrado', 404)

    // Soft delete: set status to CANCELLED
    await prisma.contract.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: { status: 'CANCELLED', updated_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'contratos',
      action: 'delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
