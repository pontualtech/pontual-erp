import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { baixaSchema } from '@/lib/validations/financeiro'
import { isReceivableSettled } from '@/lib/finance/receivable-status'
import { decidirBaixa, JANELA_BAIXA, recebeCategoria } from '@/lib/financeiro/livro-baixa'
import { AVISO_JA_LANCADO, candidatosLivro, categoriaId, ConflitoBaixa, CONFLITO_BANCO, conflitoDeBanco, dinheiroDaAR, hojeSP, nomeCategoria, travarContas } from '@/lib/financeiro/livro-baixa-db'
import { categoriaReceitaPadraoId } from '@/lib/financeiro/categoria-receita-padrao'
import { CATEGORIA_RECEITA_SERVICOS } from '@/lib/financeiro/livro-categorias'

// Lançamento já ligado por outra baixa concorrente → 409, nada escrito.
class LivroJaLigado extends Error {}

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
    if (isReceivableSettled(existing)) return error('Conta ja foi recebida', 400)
    if (existing.status === 'CANCELADO') return error('Conta cancelada nao pode ser recebida', 400)

    const body = await req.json()
    const data = baixaSchema.parse(body)

    // account_id obrigatorio (fix 22/05). Validar tenant + ativa.
    const account = await prisma.account.findFirst({
      where: { id: data.account_id, company_id: user.companyId },
    })
    if (!account) return error('Conta bancaria nao pertence a esta empresa', 403)
    if (!account.is_active) return error('Conta bancaria desativada — escolha outra', 400)

    // Bug #53 (audit 31/05): validar valor > saldo restante ANTES da transaction
    // (throw dentro de tx vira 500 via handleError mapping de Error genérico).
    const arForCheck = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { total_amount: true, received_amount: true },
    })
    if (arForCheck) {
      const remainingCents = arForCheck.total_amount - (arForCheck.received_amount || 0)
      if (data.received_amount > remainingCents) {
        return error(`Valor do recebimento (R$ ${(data.received_amount/100).toFixed(2)}) excede o saldo restante (R$ ${(remainingCents/100).toFixed(2)})`, 400)
      }
    }

    // C4 fix 22/05: race em baixa concorrente. Relemos o AR DENTRO da $transaction
    // pra evitar 2 baixas simultaneas somarem ao mesmo received_amount. Tambem
    // re-checa status — se outra baixa ja completou, retorna erro em vez de
    // criar received_amount > total.
    let ligada = false
    let receivable
    try {
    receivable = await prisma.$transaction(async (tx) => {
      // Onda 4 (§7): ordem única de travas — a conta bancária (accounts) primeiro, depois a AR; só então candidatos e
      // escritas. O livro/linhas também trava a conta antes de lançar a linha: um espera o outro e a baixa enxerga
      // a linha recém-lançada (#9), sem cruzar com o Desfazer/livro (#10).
      await travarContas(tx, user.companyId, [data.account_id])
      await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${params.id} AND company_id = ${user.companyId} FOR UPDATE`
      const fresh = await tx.accountReceivable.findFirst({
        where: { id: params.id, company_id: user.companyId, deleted_at: null },
      })
      if (!fresh) throw new ConflitoBaixa('conta não encontrada durante a baixa')
      if (isReceivableSettled(fresh)) throw new ConflitoBaixa('esta conta acabou de ser recebida por outra pessoa — recarregue')
      if (fresh.status === 'CANCELADO') throw new ConflitoBaixa('Conta cancelada durante a baixa')
      const previousReceived = fresh.received_amount || 0
      const newReceivedTotal = previousReceived + data.received_amount
      // Bug #53 (audit 31/05): baixa com valor > total causava 500. Cap explícito.
      if (newReceivedTotal > fresh.total_amount) {
        throw new ConflitoBaixa(`Valor do recebimento (R$ ${(data.received_amount/100).toFixed(2)}) excede o saldo restante (R$ ${((fresh.total_amount - previousReceived)/100).toFixed(2)})`, 422)
      }
      // Onda 3 (G1) com a trava: outra baixa comitou enquanto esta esperava (duplo clique) — o valor relido já não é
      // o que o usuário viu; não soma uma segunda baixa por cima.
      if (previousReceived !== (existing.received_amount || 0)) {
        throw new ConflitoBaixa('Baixa concorrente detectada — esta conta já foi recebida por outra requisição')
      }
      const isReceivedInFull = newReceivedTotal >= fresh.total_amount

      // Onda 4 (fix 2, F2-A): o dinheiro desta AR já está lançado além do que ela registra como recebido (crédito do
      // adquirente/CNAB/Asaas ou nocional que um estorno não compensou, linha do banco ligada a uma ref dela) →
      // só o status/valor; nenhum lançamento novo nem saldo (senão o mesmo dinheiro conta 2x). Parcelas já
      // registradas (total = recebido) não bloqueiam a próxima.
      const dinheiro = await dinheiroDaAR(tx, user.companyId, fresh)
      const jaLancado = dinheiro.total > previousReceived

      // Livro-razão (30/10): se a entrada já foi lançada pelo banco, liga a ela (decide antes de escrever).
      const dataBaixa = data.received_at ? new Date(data.received_at).toISOString().slice(0, 10) : hojeSP()
      const candidatos = jaLancado ? [] : await candidatosLivro(tx, user.companyId, data.account_id, 'CREDIT', dataBaixa, null, JANELA_BAIXA, `AR:${params.id}`)
      const categoria = fresh.category_id
        ?? await categoriaReceitaPadraoId(tx, user.companyId)
      const nomeAlvo = fresh.category_id ? await nomeCategoria(tx, user.companyId, fresh.category_id) : CATEGORIA_RECEITA_SERVICOS
      const decisao = decidirBaixa({ tipo: 'CREDIT', amount: data.received_amount, data: dataBaixa, categoria: nomeAlvo, dono: `AR:${params.id}` }, null, candidatos, JANELA_BAIXA)

      // Bug #41 (audit 31/05): mesmo race condition de AP — findFirst+update
      // não trava row. Guard atomic com updateMany where status != RECEBIDO.
      const claim = await tx.accountReceivable.updateMany({
        where: {
          id: params.id,
          company_id: user.companyId,
          status: { notIn: ['RECEBIDO', 'LIQUIDADO', 'PAGO', 'CANCELADO'] },
          deleted_at: null,
          // Onda 3 (G1): só vence se o valor recebido ainda é o relido — duas baixas parciais concorrentes
          // (duplo clique) ficam PENDENTE e passariam as duas pelo status; a 2ª dá count 0 → 409.
          ...(previousReceived === 0 ? { OR: [{ received_amount: 0 }, { received_amount: null }] } : { received_amount: previousReceived }),
        },
        data: {
          received_amount: newReceivedTotal,
          status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
          // F2-A: dinheiro já lançado — a AR sem conta fica com a conta desse lançamento.
          ...(jaLancado && !fresh.account_id && dinheiro.conta ? { account_id: dinheiro.conta } : {}),
          // Wave Z (2026-05-24): NÃO setar reconciled=true (admin confere extrato depois).
          updated_at: new Date(),
        },
      })
      if (claim.count === 0) {
        throw new ConflitoBaixa('Baixa concorrente detectada — esta conta já foi recebida por outra requisição')
      }

      const updated = await tx.accountReceivable.findFirstOrThrow({
        where: { id: params.id, company_id: user.companyId },
      })

      if (jaLancado) {
        return { updated, previousReceived, newReceivedTotal, isReceivedInFull, freshStatus: fresh.status, group_id: fresh.group_id, aviso: AVISO_JA_LANCADO }
      }

      if ('usar' in decisao) {
        // Liga ao lançamento do livro: o dinheiro já está no saldo — NÃO cria transação nem mexe na conta.
        const alvo = await tx.transaction.findFirst({
          where: { id: decisao.usar, company_id: user.companyId },
          select: { source_text: true },
        })
        // Linha já categorizada (ex.: Venda de Servicos) mantém a sua categoria.
        const linha = candidatos.find((c) => c.id === decisao.usar)
        // Guard atômico (como Bug #41/#67): só liga se a linha ainda estiver livre.
        const ligou = await tx.transaction.updateMany({
          where: { id: decisao.usar, company_id: user.companyId, linked_ref: null },
          data: {
            linked_ref: `AR:${params.id}`,
            desligada_de: null,
            ...(recebeCategoria(linha?.categoria ?? null) || linha?.desligada_de === `AR:${params.id}` ? { category_id: categoria } : {}),
            description: `Recebimento: ${existing.description} · banco: ${alvo?.source_text ?? ''}`,
            reconciled: true,
          },
        })
        if (ligou.count === 0) throw new LivroJaLigado()
        ligada = true
      } else {
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
      }

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
    }, { maxWait: 10000, timeout: 20000 })
    } catch (e) {
      if (e instanceof LivroJaLigado) return error('lançamento do livro já ligado por outra baixa', 409)
      if (e instanceof ConflitoBaixa) return error(e.message, e.status)
      if (conflitoDeBanco(e)) return error(CONFLITO_BANCO, 409)
      throw e
    }

    const { updated: receivableData, previousReceived, newReceivedTotal, isReceivedInFull, freshStatus, group_id, aviso } = receivable as any

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

    return success({ ...receivableData, ligada, ...(aviso ? { aviso } : {}) })
  } catch (err) {
    return handleError(err)
  }
}
