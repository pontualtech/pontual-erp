import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  account_type: z.enum(['CHECKING', 'SAVINGS', 'CASH']).optional(),
  bank_name: z.string().nullable().optional(),
  agency: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
  initial_balance: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

type Params = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const account = await prisma.account.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        transactions: {
          take: 20,
          orderBy: { transaction_date: 'desc' },
        },
      },
    })

    if (!account) return error('Conta bancária não encontrada', 404)
    return success(account)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.account.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Conta bancária não encontrada', 404)

    const body = await req.json()
    const data = updateAccountSchema.parse(body)

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.account_type !== undefined) updateData.account_type = data.account_type
    if (data.bank_name !== undefined) updateData.bank_name = data.bank_name
    if (data.agency !== undefined) updateData.agency = data.agency
    if (data.account_number !== undefined) updateData.account_number = data.account_number
    if (data.is_active !== undefined) updateData.is_active = data.is_active
    if (data.initial_balance !== undefined) {
      // Recalculate current_balance: adjust by the difference
      const diff = data.initial_balance - (existing.initial_balance ?? 0)
      updateData.initial_balance = data.initial_balance
      updateData.current_balance = (existing.current_balance ?? 0) + diff
    }

    await prisma.account.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: updateData,
    })
    const account = await prisma.account.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'account.update',
      entityId: account!.id,
      oldValue: { name: existing.name, account_type: existing.account_type },
      newValue: data as Record<string, unknown>,
    })

    return success(account!)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.account.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!existing) return error('Conta bancária não encontrada', 404)

    // Check if account has transactions
    const txCount = await prisma.transaction.count({
      where: { account_id: params.id },
    })
    if (txCount > 0) {
      return error(`Conta possui ${txCount} transação(ões). Remova as transações antes de excluir.`, 409)
    }

    await prisma.account.deleteMany({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'account.delete',
      entityId: params.id,
      oldValue: { name: existing.name, account_type: existing.account_type },
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
