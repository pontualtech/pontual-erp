import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/financeiro/maquininha/match
 *
 * Vincula 1 acquirer_transaction a 1 service_order (match manual).
 * Cria atomicamente:
 *  - Payment (provider='rede', status='RECEIVED', billing_type='CREDIT_CARD' ou 'DEBIT_CARD')
 *  - Atualiza/cria AccountReceivable da OS com baixa parcial/total
 *  - 2 AccountPayables: MDR (categoria "Taxas de Cartao (Operadora)") e
 *    RA (categoria "Taxa Antecipacao Automatica (RA)") — apenas se valor > 0
 *  - Append na internal_notes da OS
 *
 * Body: {
 *   transaction_id: string,    // acquirer_transaction.id
 *   service_order_id: string,
 * }
 *
 * Permission: financeiro.edit
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const { transaction_id, service_order_id } = await req.json()
    if (!transaction_id || !service_order_id) {
      return error('transaction_id e service_order_id obrigatorios', 400)
    }

    const txn = await prisma.acquirerTransaction.findFirst({
      where: { id: transaction_id, company_id: user.companyId },
    })
    if (!txn) return error('transacao nao encontrada', 404)
    if (txn.matched_payment_id) {
      return error('transacao ja esta vinculada a outro payment', 422)
    }
    if (txn.status !== 'APPROVED') {
      return error(`nao da pra vincular transacao com status ${txn.status}`, 422)
    }

    const os = await prisma.serviceOrder.findFirst({
      where: { id: service_order_id, company_id: user.companyId, deleted_at: null },
    })
    if (!os) return error('OS nao encontrada', 404)

    // Categorias pra os APs de taxa
    const [catMdr, catRa] = await Promise.all([
      prisma.category.findFirst({
        where: {
          company_id: user.companyId,
          module: 'financeiro_despesa',
          name: { contains: 'Cartao', mode: 'insensitive' },
        },
        select: { id: true },
      }),
      prisma.category.findFirst({
        where: {
          company_id: user.companyId,
          module: 'financeiro_despesa',
          name: { contains: 'Antecipacao', mode: 'insensitive' },
        },
        select: { id: true },
      }),
    ])

    const billingType = txn.modality === 'debit' ? 'DEBIT_CARD' : 'CREDIT_CARD'
    const osNum = String(os.os_number).padStart(4, '0')

    const linked = await prisma.$transaction(async (tx) => {
      // 1. Cria Payment (idempotency_key unico)
      const idempotencyKey = `rede_match_${txn.id}_${Date.now()}`
      const payment = await tx.payment.create({
        data: {
          company_id: user.companyId,
          service_order_id: os.id,
          customer_id: os.customer_id,
          provider: 'rede',
          external_id: txn.external_id,
          idempotency_key: idempotencyKey,
          amount: txn.gross_amount,
          status: 'RECEIVED',
          method: 'CARD',
          billing_type: billingType,
          paid_at: txn.transaction_date,
          metadata: {
            source: 'maquininha_match_manual',
            acquirer: txn.acquirer,
            terminal_code: txn.terminal_code,
            installments: txn.installments,
            card_brand: txn.card_brand,
            card_last_4: txn.card_last_4,
          },
        },
      })

      // 2. AccountReceivable: busca existente ou cria novo
      let receivable = await tx.accountReceivable.findFirst({
        where: {
          service_order_id: os.id,
          company_id: user.companyId,
          deleted_at: null,
          status: { not: 'CANCELADO' },
        },
      })

      if (receivable) {
        const newReceived = (receivable.received_amount || 0) + txn.gross_amount
        const fully = newReceived >= receivable.total_amount
        await tx.accountReceivable.update({
          where: { id: receivable.id },
          data: {
            received_amount: newReceived,
            status: fully ? 'RECEBIDO' : 'PARCIAL',
            charge_status: 'RECEIVED',
            payment_method: billingType,
          },
        })
      } else {
        // Categoria de receita
        const cat = await tx.category.findFirst({
          where: {
            company_id: user.companyId,
            module: 'financeiro_receita',
            name: { mode: 'insensitive', contains: 'Venda de Servi' },
          },
          select: { id: true },
        }).catch(() => null)
        receivable = await tx.accountReceivable.create({
          data: {
            company_id: user.companyId,
            customer_id: os.customer_id,
            service_order_id: os.id,
            category_id: cat?.id || null,
            description: `OS-${osNum} (cartao na maquininha — ${txn.acquirer})`,
            total_amount: txn.gross_amount,
            received_amount: txn.gross_amount,
            due_date: txn.expected_credit_date || txn.transaction_date,
            status: 'RECEBIDO',
            payment_method: billingType,
            charge_status: 'RECEIVED',
            charge_id: payment.id,
          },
        })
      }

      // 3. Atualiza Payment com receivable_id
      await tx.payment.update({
        where: { id: payment.id },
        data: { receivable_id: receivable.id },
      })

      // 4. Vincula a transacao ao payment
      await tx.acquirerTransaction.update({
        where: { id: txn.id },
        data: {
          matched_payment_id: payment.id,
          matched_at: new Date(),
          match_method: 'MANUAL',
        },
      })

      // 5. AP de MDR (se valor > 0)
      if (txn.mdr_fee_amount > 0) {
        await tx.accountPayable.create({
          data: {
            company_id: user.companyId,
            category_id: catMdr?.id || null,
            description: `MDR ${txn.acquirer} — ${txn.card_brand?.toUpperCase() || ''} ${billingType === 'DEBIT_CARD' ? 'debito' : `credito ${txn.installments}x`} — OS-${osNum} — ${txn.mdr_fee_percent.toFixed(2)}%`.trim(),
            total_amount: txn.mdr_fee_amount,
            paid_amount: txn.mdr_fee_amount,
            due_date: txn.transaction_date,
            status: 'PAGO',
            payment_method: 'Desconto automatico',
            notes: JSON.stringify({
              source: 'acquirer_match',
              acquirer: txn.acquirer,
              external_id: txn.external_id,
              fee_type: 'MDR',
              fee_percent: txn.mdr_fee_percent,
            }),
          },
        })
      }

      // 6. AP de Recebimento Automatico (RA) — se valor > 0
      if (txn.anticipation_fee_amount > 0) {
        await tx.accountPayable.create({
          data: {
            company_id: user.companyId,
            category_id: catRa?.id || null,
            description: `Antecipacao RA ${txn.acquirer} — OS-${osNum} — ${txn.anticipation_fee_percent.toFixed(2)}% (creditado em ${txn.expected_credit_date ? new Date(txn.expected_credit_date).toLocaleDateString('pt-BR') : 'D+1'})`,
            total_amount: txn.anticipation_fee_amount,
            paid_amount: txn.anticipation_fee_amount,
            due_date: txn.transaction_date,
            status: 'PAGO',
            payment_method: 'Desconto automatico',
            notes: JSON.stringify({
              source: 'acquirer_match',
              acquirer: txn.acquirer,
              external_id: txn.external_id,
              fee_type: 'ANTICIPATION',
              fee_percent: txn.anticipation_fee_percent,
            }),
          },
        })
      }

      // 7. Append nas internal_notes da OS
      const valorBRL = (txn.gross_amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const dataStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      const metodo = billingType === 'DEBIT_CARD' ? 'Cartao Debito' : `Cartao Credito ${txn.installments}x`
      const novaNota = `[${dataStr}] ✓ Pagamento confirmado (maquininha ${txn.acquirer}): ${metodo} ${valorBRL} — NSU ${txn.external_id} — terminal ${txn.terminal_code || '?'}`
      const so = await tx.serviceOrder.findUnique({
        where: { id: os.id },
        select: { internal_notes: true },
      })
      const notesAtual = so?.internal_notes ? so.internal_notes + '\n' : ''
      await tx.serviceOrder.update({
        where: { id: os.id },
        data: { internal_notes: notesAtual + novaNota },
      })

      return { payment, receivable }
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'acquirer_match_manual',
      entityId: linked.payment.id,
      newValue: {
        transaction_id: txn.id,
        os_id: os.id,
        os_number: os.os_number,
        amount: txn.gross_amount,
      },
    })

    return success({
      payment_id: linked.payment.id,
      receivable_id: linked.receivable.id,
      os_number: os.os_number,
      amount: txn.gross_amount,
    })
  } catch (err) {
    return handleError(err)
  }
}
