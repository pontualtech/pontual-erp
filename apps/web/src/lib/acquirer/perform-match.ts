import { prisma } from '@pontual/db'
import { isReceivableSettled } from '@/lib/finance/receivable-status'

/**
 * Logica compartilhada de criar Payment + AR + 2 APs ao vincular uma
 * acquirer_transaction a uma service_order. Usado por:
 *  - POST /api/financeiro/maquininha/match (manual)
 *  - POST /api/financeiro/maquininha/match-auto (batch automatico)
 *
 * Atomic: tudo em $transaction. Se qualquer passo falhar, nada e gravado.
 *
 * Retorna {ok:false, error} se transacao ou OS invalida; {ok:true, ...}
 * com IDs criados em sucesso.
 */

export interface PerformMatchInput {
  transactionId: string
  serviceOrderId: string
  companyId: string
  matchMethod: 'MANUAL' | 'AUTO'
  matchConfidence?: number
}

export interface PerformMatchResult {
  ok: boolean
  error?: string
  payment_id?: string
  receivable_id?: string
  os_number?: number
  amount?: number
}

export async function performMatch(input: PerformMatchInput): Promise<PerformMatchResult> {
  const { transactionId, serviceOrderId, companyId, matchMethod, matchConfidence } = input

  const txn = await prisma.acquirerTransaction.findFirst({
    where: { id: transactionId, company_id: companyId },
  })
  if (!txn) return { ok: false, error: 'transacao nao encontrada' }
  if (txn.matched_payment_id) return { ok: false, error: 'transacao ja esta vinculada' }
  if (txn.status !== 'APPROVED') return { ok: false, error: `status ${txn.status} nao vinculavel` }

  const os = await prisma.serviceOrder.findFirst({
    where: { id: serviceOrderId, company_id: companyId, deleted_at: null },
  })
  if (!os) return { ok: false, error: 'OS nao encontrada' }

  const [catMdr, catRa, acquirerAccountSetting] = await Promise.all([
    prisma.category.findFirst({
      where: { company_id: companyId, module: 'financeiro_despesa', name: { contains: 'Cartao', mode: 'insensitive' } },
      select: { id: true },
    }),
    prisma.category.findFirst({
      where: { company_id: companyId, module: 'financeiro_despesa', name: { contains: 'Antecipacao', mode: 'insensitive' } },
      select: { id: true },
    }),
    // 2026-06-03 fix (Karlão R$12.464,26 caiu no Inter em vez de Itaú durante 8 dias):
    // ANTES: fallback silencioso pra primeira CHECKING ASC fez Rede cair no Inter
    // (criada 26min antes do Itaú). Agora: EXIGE setting `acquirer.{acquirer}.account_id`
    // explícito. Sem fallback — melhor falhar barulhento que cair em conta errada.
    prisma.setting.findFirst({
      where: { company_id: companyId, key: `acquirer.${txn.acquirer}.account_id` },
      select: { value: true },
    }),
  ])
  const acquirerAccountId = acquirerAccountSetting?.value || null
  if (!acquirerAccountId) {
    console.error(`[perform-match] FALHA: setting acquirer.${txn.acquirer}.account_id não configurado company=${companyId}. Configure em /financeiro/maquininha/configurar antes de conciliar.`)
    return { ok: false, error: `Conta destino para ${txn.acquirer} não configurada. Vá em /financeiro/maquininha/configurar e defina a conta bancária para esse adquirente.` }
  }

  const billingType = txn.modality === 'debit' ? 'DEBIT_CARD' : 'CREDIT_CARD'
  const osNum = String(os.os_number).padStart(4, '0')

  try {
    const linked = await prisma.$transaction(async (tx) => {
      // A13 fix 22/05: chave determinística baseada em txn.id (nao Date.now)
      // pra impedir 2 cliques rapidos no botao Match Manual gerarem 2 Payments.
      // O `matched_payment_id` ja e @unique no schema, entao o segundo
      // create falha — mas com Date.now os Payments sao criados antes do
      // unique trigger, deixando 1 orfao. Com key determinística, o segundo
      // create falha em P2002 no Payment.idempotency_key.
      const idempotencyKey = `acquirer_${txn.acquirer}_${txn.id}_${matchMethod.toLowerCase()}`
      const payment = await tx.payment.create({
        data: {
          company_id: companyId,
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
            source: matchMethod === 'AUTO' ? 'maquininha_match_auto' : 'maquininha_match_manual',
            acquirer: txn.acquirer,
            terminal_code: txn.terminal_code,
            installments: txn.installments,
            card_brand: txn.card_brand,
            card_last_4: txn.card_last_4,
            match_confidence: matchConfidence,
          },
        },
      })

      let receivable = await tx.accountReceivable.findFirst({
        where: { service_order_id: os.id, company_id: companyId, deleted_at: null, status: { not: 'CANCELADO' } },
      })

      if (receivable) {
        // Fix 2026-05-27 + auditoria 2026-06-27: guard contra double-credit. Se
        // o AR já está QUITADO (RECEBIDO/LIQUIDADO/PAGO ou reconciled — ver
        // isReceivableSettled), match da maquininha NÃO soma received_amount
        // novamente — só marca reconciled=true e atualiza charge_status. Caso
        // 27/05: 5 ARs com received_amount = 2x total (R$ 2.388,11 fantasma).
        // LIQUIDADO (extrato conferido) escapava do guard antigo `=== 'RECEBIDO'`.
        if (isReceivableSettled(receivable)) {
          await tx.accountReceivable.update({
            where: { id: receivable.id },
            data: {
              reconciled: true,
              charge_status: 'RECEIVED',
            },
          })
        } else {
          const newReceived = (receivable.received_amount || 0) + txn.gross_amount
          const fully = newReceived >= receivable.total_amount
          await tx.accountReceivable.update({
            where: { id: receivable.id },
            data: {
              received_amount: newReceived,
              status: fully ? 'RECEBIDO' : 'PARCIAL',
              charge_status: 'RECEIVED',
              payment_method: billingType,
              ...(fully ? { reconciled: true } : {}),
            },
          })
        }
      } else {
        const cat = await tx.category.findFirst({
          where: { company_id: companyId, module: 'financeiro_receita', name: { mode: 'insensitive', contains: 'Venda de Servi' } },
          select: { id: true },
        }).catch(() => null)
        receivable = await tx.accountReceivable.create({
          data: {
            company_id: companyId,
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
            // 2026-06-13 (eco audit): liga a conta destino NA AR tambem (nao so na
            // Transaction de credito) — antes a AR de maquininha nascia sem
            // account_id e mostrava "Nenhum banco vinculado".
            account_id: acquirerAccountId,
          },
        })
      }

      await tx.payment.update({ where: { id: payment.id }, data: { receivable_id: receivable.id } })

      await tx.acquirerTransaction.update({
        where: { id: txn.id },
        data: {
          matched_payment_id: payment.id,
          matched_at: new Date(),
          match_method: matchMethod,
          match_confidence: matchConfidence,
        },
      })

      // AP MDR
      if (txn.mdr_fee_amount > 0) {
        await tx.accountPayable.create({
          data: {
            company_id: companyId,
            category_id: catMdr?.id || null,
            // 2026-06-13 (eco audit AP): taxa deduzida pela adquirente sai da
            // conta de liquidacao (acquirerAccountId). Antes nascia sem banco.
            account_id: acquirerAccountId,
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

      // AP RA
      if (txn.anticipation_fee_amount > 0) {
        await tx.accountPayable.create({
          data: {
            company_id: companyId,
            category_id: catRa?.id || null,
            // 2026-06-13 (eco audit AP): taxa de antecipacao sai da conta de
            // liquidacao da adquirente (acquirerAccountId).
            account_id: acquirerAccountId,
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

      // C2 fix 22/05: cria Transaction CREDIT pelo LIQUIDO (gross - mdr - antecipacao)
      // na conta destino da maquininha. Antes o match nao tocava em Account/Transaction —
      // saldo bancario nao incrementava e DRE nao cruzava com extrato bancario.
      // bank_ref=acquirer:{external_id} + reconciled=true: dedup futuro com OFX bancario
      // (Rede credita liquido D+1 e essa Transaction representa o credito antecipado).
      if (acquirerAccountId) {
        const netAmount = txn.net_amount > 0 ? txn.net_amount : (txn.gross_amount - txn.total_fee_amount)
        await tx.transaction.create({
          data: {
            company_id: companyId,
            account_id: acquirerAccountId,
            transaction_type: 'CREDIT',
            amount: netAmount,
            description: `Maquininha ${txn.acquirer} — OS-${osNum} — ${billingType === 'DEBIT_CARD' ? 'debito' : `credito ${txn.installments}x`}`,
            transaction_date: txn.expected_credit_date || txn.transaction_date,
            bank_ref: `acquirer:${txn.acquirer}:${txn.external_id}`,
            reconciled: true,
          },
        })
        await tx.account.update({
          where: { id: acquirerAccountId },
          data: { current_balance: { increment: netAmount }, updated_at: new Date() },
        })
      }

      // Bug 3 fix 22/05: marca TODAS as Installments do AR como RECEBIDO
      // quando a transacao foi antecipada (anticipation_fee_amount > 0) OU
      // expected_credit_date e proximo (D+1/D+2). Antes, parcelas 2x/3x
      // ficavam PENDENTE eternamente porque match-auto so atualizava o AR pai.
      const isAnticipated = txn.anticipation_fee_amount > 0
        || (txn.expected_credit_date && txn.transaction_date
            && (new Date(txn.expected_credit_date).getTime() - new Date(txn.transaction_date).getTime()) <= 3 * 24 * 60 * 60 * 1000)
      if (isAnticipated && receivable) {
        await tx.installment.updateMany({
          where: {
            parent_type: 'RECEIVABLE',
            parent_id: receivable.id,
            status: 'PENDENTE',
          },
          data: {
            status: 'RECEBIDO',
            paid_at: txn.expected_credit_date || txn.transaction_date,
          },
        })
      }

      // Append nas internal_notes
      const valorBRL = (txn.gross_amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const dataStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      const metodo = billingType === 'DEBIT_CARD' ? 'Cartao Debito' : `Cartao Credito ${txn.installments}x`
      const sufixo = matchMethod === 'AUTO' ? ` — match auto ${matchConfidence}%` : ''
      const novaNota = `[${dataStr}] ✓ Pagamento confirmado (maquininha ${txn.acquirer}): ${metodo} ${valorBRL} — NSU ${txn.external_id} — terminal ${txn.terminal_code || '?'}${sufixo}`
      const so = await tx.serviceOrder.findUnique({ where: { id: os.id }, select: { internal_notes: true } })
      const notesAtual = so?.internal_notes ? so.internal_notes + '\n' : ''
      await tx.serviceOrder.update({
        where: { id: os.id },
        data: { internal_notes: notesAtual + novaNota },
      })

      return { payment, receivable }
    })

    return {
      ok: true,
      payment_id: linked.payment.id,
      receivable_id: linked.receivable.id,
      os_number: os.os_number,
      amount: txn.gross_amount,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro na transacao' }
  }
}
