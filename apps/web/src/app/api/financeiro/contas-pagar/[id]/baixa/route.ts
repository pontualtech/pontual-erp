import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

type Params = { params: { id: string } }

// 2026-05-22: account_id agora OBRIGATORIO (antes era optional). Sem ele,
// AP ficava PAGO sem nenhuma Transaction DEBIT e saldo da conta nao
// diminuia — empresa "pagava" R$ 10k de boletos mas saldo continuava cheio.
const baixaSchema = z.object({
  paid_amount: z.number().int().positive('Valor pago deve ser positivo'),
  paid_at: z.string().optional(),
  account_id: z.string().uuid('Conta bancaria/caixa obrigatoria'),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a pagar nao encontrada', 404)
    if (existing.status === 'PAGO') return error('Conta ja esta paga', 400)
    if (existing.status === 'CANCELADO') return error('Conta cancelada nao pode ser paga', 400)

    const body = await req.json()
    const data = baixaSchema.parse(body)

    // Validate account ownership AND ativa
    const account = await prisma.account.findFirst({
      where: { id: data.account_id, company_id: user.companyId },
    })
    if (!account) return error('Conta bancaria nao pertence a esta empresa', 403)
    if (!account.is_active) return error('Conta bancaria desativada — escolha outra', 400)

    // C4 fix 22/05: race em baixa concorrente — rele fresh dentro da tx.
    const payable = await prisma.$transaction(async (tx) => {
      const fresh = await tx.accountPayable.findFirst({
        where: { id: params.id, company_id: user.companyId, deleted_at: null },
      })
      if (!fresh) throw new Error('AP sumiu durante a baixa')
      if (fresh.status === 'PAGO') throw new Error('Conta ja paga (outra baixa em paralelo)')
      if (fresh.status === 'CANCELADO') throw new Error('Conta cancelada durante a baixa')
      const previousPaid = fresh.paid_amount || 0
      const newPaidTotal = previousPaid + data.paid_amount
      const isPaidInFull = newPaidTotal >= fresh.total_amount

      const updated = await tx.accountPayable.update({
        where: { id: params.id, company_id: user.companyId },
        data: {
          paid_amount: newPaidTotal,
          status: isPaidInFull ? 'PAGO' : 'PENDENTE',
          payment_method: fresh.payment_method,
          // Wave Y (2026-05-24): mesmo padrão do AR baixa — reconciled=true
          // quando full paid (Transaction já nasce reconciled, AP é contraparte).
          ...(isPaidInFull ? { reconciled: true } : {}),
          updated_at: new Date(),
        },
      })

      // account_id e obrigatorio (schema), entao SEMPRE criamos Transaction
      // e debitamos saldo. C1 fix: bank_ref + reconciled=true marca a Transaction
      // como ja conciliada com o lancamento — quando OFX importar a mesma
      // transferencia, dedup por bank_ref evita DOUBLE COUNT do saldo.
      await tx.transaction.create({
        data: {
          company_id: user.companyId,
          account_id: data.account_id,
          transaction_type: 'DEBIT',
          amount: data.paid_amount,
          description: `Pgto: ${fresh.description}`,
          transaction_date: data.paid_at ? new Date(data.paid_at) : new Date(),
          bank_ref: `AP:${params.id}`,
          reconciled: true,
        },
      })

      await tx.account.update({
        where: { id: data.account_id },
        data: {
          current_balance: { decrement: data.paid_amount },
          updated_at: new Date(),
        },
      })

      return { updated, previousPaid, newPaidTotal }
    })

    const { updated: payableData, previousPaid, newPaidTotal } = payable as any

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.baixa',
      entityId: payableData.id,
      oldValue: { paid_amount: previousPaid, status: existing.status },
      newValue: { paid_amount: newPaidTotal, status: payableData.status, account_id: data.account_id },
    })

    return success(payableData)
  } catch (err) {
    return handleError(err)
  }
}
