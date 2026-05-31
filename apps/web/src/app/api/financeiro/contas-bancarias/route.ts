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
  // Bug #64 (audit 31/05 LOOP r6): cap em ±R$ 999M pra evitar overflow Int (mesma classe #42).
  // Negativo é permitido pra contas tipo cheque especial (saldo negativo válido).
  initial_balance: z.number().int().min(-9999999999, 'Saldo mínimo -R$ 99.999.999,99').max(9999999999, 'Saldo máximo R$ 99.999.999,99').default(0),
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

    // Bug #59 (audit 31/05 LOOP r4): dup prevention. Mesma classe de #54/#56/#57/#58.
    const dup = await prisma.account.findFirst({
      where: {
        company_id: user.companyId,
        name: { equals: data.name.trim(), mode: 'insensitive' },
      },
      select: { id: true, name: true },
    })
    if (dup) return error(`Já existe conta bancária "${dup.name}". Escolha outro nome.`, 409)

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
