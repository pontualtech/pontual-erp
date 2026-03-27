import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const updatePaymentConditionSchema = z.object({
  name: z.string().min(1).optional(),
  installments: z.number().int().min(1).optional(),
  interval_days: z.number().int().min(0).optional(),
  down_payment_pct: z.number().min(0).max(100).optional(),
})

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const setting = await prisma.setting.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
        key: { startsWith: 'cond_pgto.' },
      },
    })

    if (!setting) return error('Condição de pagamento não encontrada', 404)

    const parsed = JSON.parse(setting.value)
    return success({
      id: setting.id,
      key: setting.key,
      ...parsed,
      created_at: setting.created_at,
      updated_at: setting.updated_at,
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

    const existing = await prisma.setting.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
        key: { startsWith: 'cond_pgto.' },
      },
    })
    if (!existing) return error('Condição de pagamento não encontrada', 404)

    const body = await req.json()
    const data = updatePaymentConditionSchema.parse(body)

    const currentValue = JSON.parse(existing.value)
    const newValue = {
      ...currentValue,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.installments !== undefined && { installments: data.installments }),
      ...(data.interval_days !== undefined && { interval_days: data.interval_days }),
      ...(data.down_payment_pct !== undefined && { down_payment_pct: data.down_payment_pct }),
    }

    const setting = await prisma.setting.update({
      where: { id: params.id },
      data: {
        value: JSON.stringify(newValue),
        updated_at: new Date(),
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payment_condition.update',
      entityId: setting.id,
      oldValue: currentValue,
      newValue,
    })

    return success({
      id: setting.id,
      key: setting.key,
      ...newValue,
      created_at: setting.created_at,
      updated_at: setting.updated_at,
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.setting.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
        key: { startsWith: 'cond_pgto.' },
      },
    })
    if (!existing) return error('Condição de pagamento não encontrada', 404)

    const oldValue = JSON.parse(existing.value)

    await prisma.setting.delete({
      where: { id: params.id },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payment_condition.delete',
      entityId: params.id,
      oldValue,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
