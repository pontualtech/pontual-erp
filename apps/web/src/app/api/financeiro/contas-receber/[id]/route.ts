import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

type Params = { params: { id: string } }

const updateReceivableSchema = z.object({
  customer_id: z.string().nullable().optional(),
  service_order_id: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  total_amount: z.number().int().positive().optional(),
  due_date: z.string().optional(),
  category_id: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  status: z.enum(['PENDENTE', 'RECEBIDO', 'CANCELADO']).optional(),
})

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const receivable = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: { select: { id: true, legal_name: true, document_number: true } },
        categories: { select: { id: true, name: true } },
        service_orders: { select: { id: true, os_number: true, status_id: true } },
      },
    })

    if (!receivable) return error('Conta a receber nao encontrada', 404)

    // Get installments
    const installments = await prisma.installment.findMany({
      where: { parent_type: 'RECEIVABLE', parent_id: receivable.id },
      orderBy: { installment_number: 'asc' },
    })

    // Get bank accounts for reference
    const accounts = await prisma.account.findMany({
      where: { company_id: user.companyId, is_active: true },
      select: { id: true, name: true, bank_name: true },
      orderBy: { name: 'asc' },
    })

    // Get other pending receivables from the same customer (for unification)
    let otherPending: any[] = []
    if (receivable.customer_id && receivable.status === 'PENDENTE') {
      otherPending = await prisma.accountReceivable.findMany({
        where: {
          company_id: user.companyId,
          customer_id: receivable.customer_id,
          status: 'PENDENTE',
          deleted_at: null,
          grouped_into_id: null,
          id: { not: receivable.id },
        },
        select: {
          id: true, description: true, total_amount: true,
          due_date: true, payment_method: true,
          service_orders: { select: { id: true, os_number: true } },
        },
        orderBy: { due_date: 'asc' },
      })
    }

    // Get grouped receivables if this is a group parent
    let groupedItems: any[] = []
    if (receivable.group_id && !receivable.grouped_into_id) {
      groupedItems = await prisma.accountReceivable.findMany({
        where: {
          group_id: receivable.group_id,
          grouped_into_id: receivable.id,
          deleted_at: null,
        },
        select: {
          id: true, description: true, total_amount: true, due_date: true,
          service_orders: { select: { id: true, os_number: true } },
        },
        orderBy: { due_date: 'asc' },
      })
    }

    return success({
      ...receivable,
      installments,
      accounts,
      other_pending: otherPending,
      grouped_items: groupedItems,
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a receber nao encontrada', 404)
    if (['RECEBIDO', 'CANCELADO', 'AGRUPADO'].includes(existing.status || '')) {
      return error('Conta nao pode ser editada neste status', 400)
    }

    const body = await req.json()
    const data = updateReceivableSchema.parse(body)

    const updateData: any = { ...data, updated_at: new Date() }
    if (data.due_date) updateData.due_date = new Date(data.due_date)

    const receivable = await prisma.accountReceivable.update({
      where: { id: params.id },
      data: updateData,
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.update',
      entityId: receivable.id,
      oldValue: { description: existing.description, total_amount: existing.total_amount, status: existing.status },
      newValue: data as any,
    })

    return success(receivable)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a receber nao encontrada', 404)

    await prisma.accountReceivable.update({
      where: { id: params.id },
      data: { deleted_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
