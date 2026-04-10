import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

type Params = { params: { id: string } }

const updatePayableSchema = z.object({
  supplier_id: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  total_amount: z.number().int().positive().optional(),
  due_date: z.string().optional(),
  category_id: z.string().nullable().optional(),
  cost_center_id: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  status: z.enum(['PENDENTE', 'PAGO', 'CANCELADO']).optional(),
})

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const payable = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: { select: { id: true, legal_name: true, document_number: true } },
        categories: { select: { id: true, name: true } },
        cost_centers: { select: { id: true, name: true } },
      },
    })

    if (!payable) return error('Conta a pagar nao encontrada', 404)

    // Get installments
    const installments = await prisma.installment.findMany({
      where: { parent_type: 'PAYABLE', parent_id: payable.id },
      orderBy: { installment_number: 'asc' },
    })

    // Get bank accounts, categories, cost centers for edit
    const [accounts, categories, costCenters] = await Promise.all([
      prisma.account.findMany({ where: { company_id: user.companyId, is_active: true }, select: { id: true, name: true, bank_name: true }, orderBy: { name: 'asc' } }),
      prisma.category.findMany({ where: { company_id: user.companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.costCenter.findMany({ where: { company_id: user.companyId, is_active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])

    return success({ ...payable, installments, accounts, categories, cost_centers: costCenters })
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a pagar nao encontrada', 404)

    const body = await req.json()
    const data = updatePayableSchema.parse(body)

    const updateData: any = { ...data, updated_at: new Date() }
    if (data.due_date) updateData.due_date = new Date(data.due_date)

    const payable = await prisma.accountPayable.update({
      where: { id: params.id },
      data: updateData,
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.update',
      entityId: payable.id,
      oldValue: { description: existing.description, total_amount: existing.total_amount, status: existing.status },
      newValue: data as any,
    })

    return success(payable)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a pagar nao encontrada', 404)

    await prisma.accountPayable.update({
      where: { id: params.id },
      data: { deleted_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
