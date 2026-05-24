import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

type Params = { params: { id: string } }

// C11 fix 22/05: status NAO aceita PAGO via PATCH — PAGO so via /baixa.
const updatePayableSchema = z.object({
  supplier_id: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  total_amount: z.number().int().positive().optional(),
  due_date: z.string().optional(),
  category_id: z.string().nullable().optional(),
  cost_center_id: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  status: z.enum(['PENDENTE', 'CANCELADO']).optional(),
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

    // Wave AB-fix2 (2026-05-24): mesma estratégia do AR. AP em PAGO/CANCELADO
    // permite atualizar account_id e notes (admin conferindo extrato). Demais
    // campos bloqueados — preservam invariantes financeiros.
    const isTerminalStatus = ['PAGO', 'CANCELADO'].includes(existing.status || '')
    if (isTerminalStatus) {
      const allowedKeys = new Set(['account_id', 'notes'])
      const submittedKeys = Object.keys(data)
      const blockedKeys = submittedKeys.filter(k => !allowedKeys.has(k))
      if (blockedKeys.length > 0) {
        return error(
          `Conta em status ${existing.status} — só pode atualizar banco vinculado e notas. Campos não permitidos: ${blockedKeys.join(', ')}.`,
          400
        )
      }
    }

    // C15 fix 22/05: valida supplier_id pertence ao tenant
    if (data.supplier_id) {
      const supplier = await prisma.customer.findFirst({
        where: { id: data.supplier_id, company_id: user.companyId, deleted_at: null },
        select: { id: true },
      })
      if (!supplier) return error('Fornecedor nao pertence a esta empresa', 403)
    }

    // A5 fix 22/05: invariante total_amount >= paid_amount.
    if (data.total_amount !== undefined) {
      const currentPaid = existing.paid_amount || 0
      if (data.total_amount < currentPaid) {
        return error(`Total (${data.total_amount}) menor que o ja pago (${currentPaid}). Estorne primeiro se quer reduzir.`, 400)
      }
    }

    const updateData: any = { ...data, updated_at: new Date() }
    if (data.due_date) updateData.due_date = new Date(data.due_date)

    await prisma.accountPayable.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: updateData,
    })
    const payable = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.update',
      entityId: payable!.id,
      oldValue: { description: existing.description, total_amount: existing.total_amount, status: existing.status },
      newValue: data as any,
    })

    return success(payable!)
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

    await prisma.accountPayable.updateMany({
      where: { id: params.id, company_id: user.companyId },
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
