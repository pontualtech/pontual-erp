import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * Sprint UX-23 — Transferência entre Bancos
 *
 * Cria DUAS Transactions em uma única transaction (DB):
 *   1. DEBIT na conta origem
 *   2. CREDIT na conta destino
 * E atualiza current_balance de ambas.
 *
 * Bug reportado pelo Karlão (Audit 14): "modulo financeiro não possui
 * categoria que se possa fazer transferência entre bancos, ex Itaú e Asaas".
 */
const transferSchema = z.object({
  from_account_id: z.string().min(1, 'Conta origem é obrigatória'),
  to_account_id: z.string().min(1, 'Conta destino é obrigatória'),
  amount: z.number().int().positive('Valor deve ser positivo'),
  transfer_date: z.string().optional(),
  description: z.string().optional(),
  // C6 fix 22/05: por padrao bloqueia transferencia que deixaria conta origem
  // negativa. Cliente que quiser explicito assumir o negativo (ex: cheque
  // especial) passa allow_negative=true.
  allow_negative: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const data = transferSchema.parse(body)

    if (data.from_account_id === data.to_account_id) {
      return error('Conta origem e destino devem ser diferentes', 400)
    }

    // Validar que ambas contas existem e pertencem ao tenant
    const [fromAccount, toAccount] = await Promise.all([
      prisma.account.findFirst({
        where: { id: data.from_account_id, company_id: user.companyId, is_active: true },
      }),
      prisma.account.findFirst({
        where: { id: data.to_account_id, company_id: user.companyId, is_active: true },
      }),
    ])
    if (!fromAccount) return error('Conta origem não encontrada ou inativa', 404)
    if (!toAccount) return error('Conta destino não encontrada ou inativa', 404)

    // C6 fix 22/05: por padrao BLOQUEIA transferencia que deixaria saldo
    // negativo. Cliente passa allow_negative=true pra forcar (ex: cheque
    // especial confirmado). Antes era so warning — saldos viraram -100k
    // sem ninguem perceber.
    const insufficient = (fromAccount.current_balance ?? 0) < data.amount
    if (insufficient && !data.allow_negative) {
      return error(
        `Saldo insuficiente em ${fromAccount.name}: R$ ${((fromAccount.current_balance ?? 0)/100).toFixed(2)} disponivel, transferencia de R$ ${(data.amount/100).toFixed(2)}. Use allow_negative=true se for intencional.`,
        400
      )
    }

    const transferDate = data.transfer_date ? new Date(data.transfer_date) : new Date()
    const description = data.description?.trim() ||
      `Transferência ${fromAccount.name} → ${toAccount.name}`

    const result_tx = await prisma.$transaction(async tx => {
      // 1. DEBIT origem
      const debit = await tx.transaction.create({
        data: {
          company_id: user.companyId,
          account_id: data.from_account_id,
          transaction_type: 'DEBIT',
          amount: data.amount,
          description: `[Transf saída] ${description}`,
          transaction_date: transferDate,
        },
      })
      await tx.account.update({
        where: { id: data.from_account_id },
        data: {
          current_balance: { decrement: data.amount },
          updated_at: new Date(),
        },
      })

      // 2. CREDIT destino
      const credit = await tx.transaction.create({
        data: {
          company_id: user.companyId,
          account_id: data.to_account_id,
          transaction_type: 'CREDIT',
          amount: data.amount,
          description: `[Transf entrada] ${description}`,
          // bank_ref permite ligar as 2 transactions (auditoria)
          bank_ref: `TRANSFER:${debit.id}`,
          transaction_date: transferDate,
        },
      })

      // Atualizar bank_ref do DEBIT pra apontar pro CREDIT (pareamento)
      await tx.transaction.update({
        where: { id: debit.id },
        data: { bank_ref: `TRANSFER:${credit.id}` },
      })

      await tx.account.update({
        where: { id: data.to_account_id },
        data: {
          current_balance: { increment: data.amount },
          updated_at: new Date(),
        },
      })

      return { debit_id: debit.id, credit_id: credit.id }
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'transfer.create',
      entityId: result_tx.debit_id,
      newValue: {
        from: fromAccount.name,
        to: toAccount.name,
        amount: data.amount,
        debit_id: result_tx.debit_id,
        credit_id: result_tx.credit_id,
      },
    })

    return success({
      ...result_tx,
      from_account: fromAccount.name,
      to_account: toAccount.name,
      amount: data.amount,
      warning: insufficient
        ? `Saldo da conta ${fromAccount.name} ficará negativo`
        : undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return error(e.errors[0]?.message || 'Dados inválidos', 422)
    }
    return handleError(e)
  }
}
