import { prisma } from '@pontual/db'
import { novoEstadoReceivable, planoTaxas } from './match-rules'
import { categoriaReceitaPadraoId } from '@/lib/financeiro/categoria-receita-padrao'
import { compensado, ondeRef } from '@/lib/financeiro/livro'
import { candidatosLivro, CONFLITO_BANCO, conflitoDeBanco, posAjuste, travarContas } from '@/lib/financeiro/livro-baixa-db'
import { decidirBaixa, JANELA_BAIXA } from '@/lib/financeiro/livro-baixa'
import { isReceivableSettled } from '@/lib/finance/receivable-status'
import { avisarDuplicidade } from '@/lib/financeiro/aviso-duplicidade'

// Fix 6 (F6-E, m2): a AR escolhida foi excluída/cancelada enquanto o vínculo esperava a trava → desfaz tudo.
class ArMudou extends Error {}

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
  // Dia em que o líquido da venda caiu no banco (visto no extrato pela conciliação da manhã).
  // Com ele a AR vira LIQUIDADO e o crédito/parcelas ficam com essa data (Karlão 29/10).
  creditDate?: Date
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
  const { transactionId, serviceOrderId, companyId, matchMethod, matchConfidence, creditDate } = input

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

  // Fix 6 (F6-F): o aviso de duplicidade só sai depois do commit (nunca num rollback).
  let duplicidade: { conta: string; receivable_id: string } | null = null
  try {
    const linked = await prisma.$transaction(async (tx) => {
      // Onda 4 (fix 2, F2-D, #4): ordem única de travas — a conta de liquidação (accounts) antes da AR e da checagem
      // "já lançado", como as rotas do §7.
      await travarContas(tx, companyId, [acquirerAccountId])
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

      // 05/11 (OS 62959, cartão + Pix): com mais de uma conta na OS, a venda vai para a do valor dela, não para a primeira.
      const contasDaOS = await tx.accountReceivable.findMany({
        where: { service_order_id: os.id, company_id: companyId, deleted_at: null, status: { not: 'CANCELADO' } },
      })
      let receivable = contasDaOS.find((a) => a.total_amount === txn.gross_amount) ?? contasDaOS[0] ?? null
      let quitadaAntes = false

      if (receivable) {
        // Fix 4 (F4-D, #6): trava a AR (depois da conta — ordem do §7) e decide pela releitura: um Receber/Conferir/webhook
        // que comitou enquanto esperava conta no received_amount (senão o match grava por cima da foto velha).
        await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${receivable.id} AND company_id = ${companyId} FOR UPDATE`
        const relida = await tx.accountReceivable.findFirst({ where: { id: receivable.id, company_id: companyId } })
        // Fix 6 (F6-E, m2): excluída/cancelada durante a espera → nada é escrito (nem Payment, nem crédito).
        if (!relida || relida.deleted_at || relida.status === 'CANCELADO') throw new ArMudou('conta a receber excluída ou cancelada durante o vínculo — repita')
        receivable = relida
        // Fix 2026-05-27 + auditoria 2026-06-27: guard contra double-credit. Se
        // o AR já está QUITADO (RECEBIDO/LIQUIDADO/PAGO ou reconciled — ver
        // isReceivableSettled), match da maquininha NÃO soma received_amount
        // novamente (caso 27/05: R$ 2.388,11 fantasma). Regras em match-rules.ts;
        // com creditDate (banco confirmou) a AR vira LIQUIDADO.
        quitadaAntes = isReceivableSettled(receivable)
        await tx.accountReceivable.update({
          where: { id: receivable.id },
          data: novoEstadoReceivable(receivable, txn.gross_amount, billingType, !!creditDate),
        })
      } else {
        const categoryId = await categoriaReceitaPadraoId(tx, companyId).catch(() => null)
        receivable = await tx.accountReceivable.create({
          data: {
            company_id: companyId,
            customer_id: os.customer_id,
            service_order_id: os.id,
            category_id: categoryId,
            description: `OS-${osNum} (cartao na maquininha — ${txn.acquirer})`,
            total_amount: txn.gross_amount,
            received_amount: txn.gross_amount,
            due_date: txn.expected_credit_date || txn.transaction_date,
            status: creditDate ? 'LIQUIDADO' : 'RECEBIDO',
            ...(creditDate ? { reconciled: true } : {}),
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

      // Taxa estimada da entrega × taxa real da adquirente: "não pode ser lançado a taxa em dobro" (Karlão 29/10).
      // Estimada PENDENTE → cancelada; estimada já PAGA → não lança a real.
      // Fix 6 (F6-E, m3): trava as APs da OS (FOR UPDATE, por id) e decide pela releitura — a estimada paga enquanto
      // esperava não é cancelada nem deixa entrar a taxa real (taxa em dobro); só cancela a que ainda está PENDENTE.
      const candidatasAP = await tx.accountPayable.findMany({
        where: { company_id: companyId, deleted_at: null, status: { not: 'CANCELADO' }, description: { contains: `OS-${osNum}`, mode: 'insensitive' } },
        select: { id: true },
      })
      for (const id of candidatasAP.map((a) => a.id).sort()) {
        await tx.$queryRaw`SELECT id FROM accounts_payable WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`
      }
      const apsDaOS = candidatasAP.length === 0 ? [] : await tx.accountPayable.findMany({
        where: { id: { in: candidatasAP.map((a) => a.id) }, company_id: companyId, deleted_at: null, status: { not: 'CANCELADO' } },
        select: { id: true, description: true, status: true },
      })
      const taxas = planoTaxas(apsDaOS, os.os_number)
      if (taxas.cancelar.length) {
        await tx.accountPayable.updateMany({
          where: { id: { in: taxas.cancelar }, company_id: companyId, status: 'PENDENTE' },
          data: { status: 'CANCELADO', notes: `Cancelada: taxa estimada na entrega substituída pela taxa real da ${txn.acquirer} (NSU ${txn.external_id}).`, updated_at: new Date() },
        })
      }

      // AP MDR
      if (taxas.lancarReal && txn.mdr_fee_amount > 0) {
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
      if (taxas.lancarReal && txn.anticipation_fee_amount > 0) {
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
      // Onda 4 (fix 1): o crédito desta venda já existe — nocional (bank_ref) ou já convertido pelo livro na linha do
      // banco (linked_ref)? Então não lança outro.
      const refCredito = `acquirer:${txn.acquirer}:${txn.external_id}`
      const creditoJaLancado = await tx.transaction.findFirst({
        where: { company_id: companyId, ...ondeRef(refCredito) },
        select: { id: true },
      })
      // Fix 6 (F6-E, #6): AR já quitada por um Receber manual antes do match — o dinheiro pode já estar lançado pela ref
      // própria (como no webhook Asaas, F4-D): linha do banco ligada a AR:<id> na conta da adquirente → não credita;
      // nocional AR:<id> vivo nessa conta → SWAP (apaga com o saldo; entra o acquirer: líquido); dinheiro AR:<id> noutra
      // conta → credita e avisa a possível duplicidade (depois do commit).
      const netAmount = txn.net_amount > 0 ? txn.net_amount : (txn.gross_amount - txn.total_fee_amount)
      let jaNoBanco = false
      if (acquirerAccountId && !creditoJaLancado && quitadaAntes && receivable) {
        const proprio = `AR:${receivable.id}`
        const linhas = await tx.transaction.findMany({
          where: { company_id: companyId, origin: 'BANCO', linked_ref: proprio, transaction_type: 'CREDIT' },
          select: { account_id: true, amount: true },
        })
        // 05/11 (OS 62473, paga em 2 formas): só é esta venda a linha que cobre o líquido dela. O Pix ligado à mesma AR não é o
        // repasse do cartão: contá-lo como "já no banco" deixava o nocional do cartão vivo ao lado do repasse (dinheiro 2x).
        jaNoBanco = linhas.some((l) => l.account_id === acquirerAccountId && l.amount >= netAmount)
        const creditos = await tx.transaction.findMany({
          where: { company_id: companyId, bank_ref: proprio, transaction_type: 'CREDIT', origin: null, source_text: null },
          select: { id: true, amount: true, account_id: true, created_at: true },
        })
        const estornos = await tx.transaction.findMany({
          where: { company_id: companyId, bank_ref: `${proprio}:estorno` },
          select: { account_id: true, created_at: true },
        })
        // Fix 7 (F7-A): só o nocional posterior ao ajuste de caixa da conta (o anterior o ajuste já absorveu).
        const vivos = await posAjuste(tx, companyId, creditos.filter((c) => !compensado(c, estornos)))
        if (!jaNoBanco) {
          for (const c of vivos.filter((v) => v.account_id === acquirerAccountId)) {
            await tx.transaction.delete({ where: { id: c.id } })
            await tx.account.update({ where: { id: acquirerAccountId }, data: { current_balance: { decrement: c.amount }, updated_at: new Date() } })
          }
        }
        const fora = [...vivos, ...linhas].find((t) => t.account_id !== acquirerAccountId)
        if (fora) duplicidade = { conta: fora.account_id, receivable_id: receivable.id }
      }
      if (acquirerAccountId && !creditoJaLancado && !jaNoBanco) {
        const dataCredito = creditDate || txn.expected_credit_date || txn.transaction_date
        const descricao = `Maquininha ${txn.acquirer} — OS-${osNum} — ${billingType === 'DEBIT_CARD' ? 'debito' : `credito ${txn.installments}x`}`
        // 05/11 (OS 63022): o repasse já entrou no livro como linha do banco livre (o extrato chegou antes do vínculo) →
        // liga a ela, como o Receber faz; criar o acquirer: por cima contava o mesmo dinheiro 2x. Mesmo valor líquido, na
        // conta da adquirente, na janela da baixa; a linha mantém a categoria (receita) e o saldo não muda.
        const dia = new Date(dataCredito).toISOString().slice(0, 10)
        const candidatos = await candidatosLivro(tx, companyId, acquirerAccountId, 'CREDIT', dia, null, JANELA_BAIXA)
        const decisao = decidirBaixa({ tipo: 'CREDIT', amount: netAmount, data: dia, categoria: null }, null, candidatos, JANELA_BAIXA)
        if ('usar' in decisao) {
          const alvo = await tx.transaction.findFirst({ where: { id: decisao.usar, company_id: companyId }, select: { source_text: true } })
          const ligou = await tx.transaction.updateMany({
            where: { id: decisao.usar, company_id: companyId, linked_ref: null },
            data: { linked_ref: refCredito, description: `${descricao} · banco: ${alvo?.source_text ?? ''}`, reconciled: true },
          })
          if (ligou.count === 0) throw new ArMudou('a linha do banco do repasse foi ligada por outra operação — repita')
        } else {
          await tx.transaction.create({
            data: {
              company_id: companyId,
              account_id: acquirerAccountId,
              transaction_type: 'CREDIT',
              amount: netAmount,
              description: descricao,
              transaction_date: dataCredito,
              bank_ref: refCredito,
              reconciled: true,
            },
          })
          await tx.account.update({
            where: { id: acquirerAccountId },
            data: { current_balance: { increment: netAmount }, updated_at: new Date() },
          })
        }
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
            paid_at: creditDate || txn.expected_credit_date || txn.transaction_date,
          },
        })
      }

      // Append nas internal_notes
      const valorBRL = (txn.gross_amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const dataStr = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      const metodo = billingType === 'DEBIT_CARD' ? 'Cartao Debito' : `Cartao Credito ${txn.installments}x`
      const sufixo = (matchMethod === 'AUTO' ? ` — match auto ${matchConfidence}%` : '')
        + (creditDate ? ` — creditado no banco em ${creditDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (liquidado)` : '')
        + (taxas.lancarReal ? '' : ' — taxa real NÃO lançada: a taxa estimada já estava paga')
      const novaNota = `[${dataStr}] ✓ Pagamento confirmado (maquininha ${txn.acquirer}): ${metodo} ${valorBRL} — NSU ${txn.external_id} — terminal ${txn.terminal_code || '?'}${sufixo}`
      const so = await tx.serviceOrder.findUnique({ where: { id: os.id }, select: { internal_notes: true } })
      const notesAtual = so?.internal_notes ? so.internal_notes + '\n' : ''
      await tx.serviceOrder.update({
        where: { id: os.id },
        data: { internal_notes: notesAtual + novaNota },
      })

      return { payment, receivable }
    }, { maxWait: 10000, timeout: 20000 })

    // (atribuída dentro do callback da tx — o TS não acompanha; a leitura é depois do commit)
    const d = duplicidade as { conta: string; receivable_id: string } | null
    if (d) {
      const conta = await prisma.account.findFirst({ where: { id: d.conta }, select: { name: true } }).catch(() => null)
      await avisarDuplicidade(companyId, `(NSU ${txn.external_id})`,
        `possível duplicidade: AR recebida manualmente em ${conta?.name ?? d.conta} e também pela ${txn.acquirer}`,
        { url: 'perform-match', params: { receivable_id: d.receivable_id, nsu: txn.external_id } })
    }

    return {
      ok: true,
      payment_id: linked.payment.id,
      receivable_id: linked.receivable.id,
      os_number: os.os_number,
      amount: txn.gross_amount,
    }
  } catch (e) {
    // Fix 3 (F3-D, #4): trava demorou/deadlock → mensagem de 'repita' em vez do erro cru do Prisma.
    if (conflitoDeBanco(e)) return { ok: false, error: CONFLITO_BANCO }
    if (e instanceof ArMudou) return { ok: false, error: e.message }
    return { ok: false, error: e instanceof Error ? e.message : 'erro na transacao' }
  }
}
