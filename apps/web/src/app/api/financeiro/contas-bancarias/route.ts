import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const createAccountSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  account_type: z.enum(['CHECKING', 'SAVINGS', 'CASH']).default('CHECKING'),
  bank_name: z.string().nullable().optional(),
  agency: z.string().nullable().optional(),
  account_number: z.string().nullable().optional(),
  initial_balance: z.number().int().default(0),
  is_active: z.boolean().optional().default(true),
})

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const accounts = await prisma.account.findMany({
      where: { company_id: user.companyId },
      orderBy: { name: 'asc' },
    })

    return success(accounts)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const data = createAccountSchema.parse(body)

    const account = await prisma.account.create({
      data: {
        company_id: user.companyId,
        name: data.name,
        account_type: data.account_type,
        bank_name: data.bank_name ?? null,
        agency: data.agency ?? null,
        account_number: data.account_number ?? null,
        initial_balance: data.initial_balance,
        current_balance: data.initial_balance,
        is_active: data.is_active,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'account.create',
      entityId: account.id,
      newValue: { name: data.name, account_type: data.account_type, initial_balance: data.initial_balance },
    })

    return success(account, 201)
  } catch (err) {
    return handleError(err)
  }
}
