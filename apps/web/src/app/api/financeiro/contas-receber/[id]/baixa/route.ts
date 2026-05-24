import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { baixaSchema } from '@/lib/validations/financeiro'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a receber nao encontrada', 404)
    if (existing.status === 'RECEBIDO') return error('Conta ja foi recebida', 400)
    if (existing.status === 'CANCELADO') return error('Conta cancelada nao pode ser recebida', 400)

    const body = await req.json()
    const data = baixaSchema.parse(body)

    // account_id obrigatorio (fix 22/05). Validar tenant + ativa.
    const account = await prisma.account.findFirst({
      where: { id: data.account_id, company_id: user.companyId },
    })
    if (!account) return error('Conta bancaria nao pertence a esta empresa', 403)
    if (!account.is_active) return error('Conta bancaria desativada — escolha outra', 400)

    // C4 fix 22/05: race em baixa concorrente. Relemos o AR DENTRO da $transaction
    // pra evitar 2 baixas simultaneas somarem ao mesmo received_amount. Tambem
    // re-checa status — se outra baixa ja completou, retorna erro em vez de
    // criar received_amount > total.
    const receivable = await prisma.$transaction(async (tx) => {
      const fresh = await tx.accountReceivable.findFirst({
        where: { id: params.id, company_id: user.companyId, deleted_at: null },
      })
      if (!fresh) throw new Error('AR sumiu durante a baixa')
      if (fresh.status === 'RECEBIDO') throw new Error('Conta ja foi recebida (outra baixa em paralelo)')
      if (fresh.status === 'CANCELADO') throw new Error('Conta cancelada durante a baixa')
      const previousReceived = fresh.received_amount || 0
      const newReceivedTotal = previousReceived + data.received_amount
      const isReceivedInFull = newReceivedTotal >= fresh.total_amount

      const updated = await tx.accountReceivable.update({
        where: { id: params.id, company_id: user.companyId },
        data: {
          received_amount: newReceivedTotal,
          status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
          // Wave Z (2026-05-24): NÃO setar reconciled=true. Karlão deixou claro:
          // /baixa é atendente DECLARANDO recebimento (cliente mostrou comprovante).
          // Conciliação só vale depois que admin confere no extrato bancário. Admin
          // marca reconciled=true via botão "Conferi no extrato" no detalhe da AR
          // (Wave Z) ou via /conciliacao/match (OFX). Exceções automáticas: Asaas
          // webhook + CNAB Inter (já marcam reconciled=true sozinhos).
          updated_at: new Date(),
        },
      })

      // account_id e obrigatorio agora — sempre cria Transaction + ajusta saldo.
      // bank_ref+reconciled=true (C1 fix 22/05): marca a transacao como ja
      // conciliada com o lancamento do ERP. Quando OFX bancario importar
      // a mesma entrada, dedup por bank_ref evita DOUBLE COUNT no saldo.
      await tx.transaction.create({
        data: {
          company_id: user.companyId,
          account_id: data.account_id,
          transaction_type: 'CREDIT',
          amount: data.received_amount,
          description: `Recebimento: ${existing.description}`,
          transaction_date: data.received_at ? new Date(data.received_at) : new Date(),
          bank_ref: `AR:${params.id}`,
          reconciled: true,
        },
      })

      // Atualizar saldo da conta bancária
      await tx.account.update({
        where: { id: data.account_id },
        data: {
          current_balance: { increment: data.received_amount },
          updated_at: new Date(),
        },
      })

      // Auto-pay card fee when receivable is fully paid
      // Audit 14 fix: usa service_order_id (nao description regex frágil)
      if (isReceivedInFull && fresh.card_fee_total && fresh.card_fee_total > 0 && fresh.service_order_id) {
        const cardFeePayable = await tx.accountPayable.findFirst({
          where: {
            company_id: user.companyId,
            service_order_id: fresh.service_order_id,
            total_amount: fresh.card_fee_total,
            status: 'PENDENTE',
            deleted_at: null,
          },
        })
        if (cardFeePayable) {
          await tx.accountPayable.update({
            where: { id: cardFeePayable.id },
            data: { status: 'PAGO', paid_amount: cardFeePayable.total_amount, updated_at: new Date() },
          })
          await tx.transaction.create({
            data: {
              company_id: user.companyId,
              account_id: data.account_id,
              transaction_type: 'DEBIT',
              amount: fresh.card_fee_total,
              description: `Taxa cartão: ${fresh.description}`,
              transaction_date: data.received_at ? new Date(data.received_at) : new Date(),
              bank_ref: `AP:${cardFeePayable.id}`,
              reconciled: true,
            },
          })
          await tx.account.update({
            where: { id: data.account_id },
            data: { current_balance: { decrement: fresh.card_fee_total }, updated_at: new Date() },
          })
        }
      }

      return { updated, previousReceived, newReceivedTotal, isReceivedInFull, freshStatus: fresh.status, group_id: fresh.group_id }
    })

    const { updated: receivableData, previousReceived, newReceivedTotal, isReceivedInFull, freshStatus, group_id } = receivable as any

    // If this is a GROUPED receivable that was fully paid, mark all originals as RECEBIDO
    if (isReceivedInFull && group_id) {
      const originals = await prisma.accountReceivable.findMany({
        where: {
          grouped_into_id: receivableData.id,
          company_id: user.companyId,
          deleted_at: null,
        },
      })

      if (originals.length > 0) {
        await prisma.accountReceivable.updateMany({
          where: { grouped_into_id: receivableData.id, company_id: user.companyId },
          data: {
            status: 'RECEBIDO',
            received_amount: undefined, // keep original amounts
            updated_at: new Date(),
          },
        })
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.baixa',
      entityId: receivableData.id,
      oldValue: { received_amount: previousReceived, status: existing.status },
      newValue: { received_amount: newReceivedTotal, status: receivableData.status, account_id: data.account_id },
    })

    return success(receivableData)
  } catch (err) {
    return handleError(err)
  }
}
