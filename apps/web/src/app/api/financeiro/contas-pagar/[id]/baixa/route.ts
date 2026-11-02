import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'
import { decidirBaixa, JANELA_BAIXA, recebeCategoria, TOLERANCIA_EXPLICITO } from '@/lib/financeiro/livro-baixa'
import { candidatosLivro, ConflitoBaixa, hojeSP, nomeCategoria, travarContas } from '@/lib/financeiro/livro-baixa-db'

// Escolha explícita de lançamento do livro inválida → 422 sem escrever nada.
class LivroInvalido extends Error {}
// Lançamento já ligado por outra baixa concorrente → 409, nada escrito.
class LivroJaLigado extends Error {}
// Valor acima do restante detectado dentro da tx (a pré-checagem tolera R$ 1 com vínculo explícito) → 400, nada escrito.
class ValorExcedeRestante extends Error {}

type Params = { params: { id: string } }

// 2026-05-22: account_id agora OBRIGATORIO (antes era optional). Sem ele,
// AP ficava PAGO sem nenhuma Transaction DEBIT e saldo da conta nao
// diminuia — empresa "pagava" R$ 10k de boletos mas saldo continuava cheio.
const baixaSchema = z.object({
  paid_amount: z.number().int().positive('Valor pago deve ser positivo'),
  // Onda 4 (§8): data inválida vira 422 (antes: RangeError dentro da tx → 500).
  paid_at: z.string().optional().refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Data de pagamento inválida'),
  account_id: z.string().uuid('Conta bancaria/caixa obrigatoria'),
  // 30/10 (livro-razão): lançamento do banco já existente a ligar em vez de criar outra saída.
  livro_transaction_id: z.string().optional(),
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

    // Bug #53 (audit 31/05): validar amount > saldo restante ANTES da transaction
    // (throw dentro de transaction vira 500 via handleError). Pequena race com baixa
    // concorrente é tratada DENTRO da tx com updateMany guard de status.
    const apForCheck = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { total_amount: true, paid_amount: true },
    })
    if (apForCheck) {
      const remainingCents = apForCheck.total_amount - (apForCheck.paid_amount || 0)
      // Vínculo explícito (F6): a linha do banco pode exceder o restante em até R$ 1 — a baixa quita pelo restante.
      const tolerancia = data.livro_transaction_id ? TOLERANCIA_EXPLICITO : 0
      if (data.paid_amount > remainingCents + tolerancia) {
        return error(`Valor da baixa (R$ ${(data.paid_amount/100).toFixed(2)}) excede o saldo restante (R$ ${(remainingCents/100).toFixed(2)})`, 400)
      }
    }

    // Bug #41 (audit 31/05): C4 fix anterior usava findFirst+update que NÃO
    // bloqueia o row → 3 baixas concorrentes criavam 3 Transactions e
    // decrementavam saldo 3x. Fix: updateMany com where status != PAGO
    // como guard atomic — só a primeira a commitar dá count=1; as outras
    // retornam count=0 e abortam ANTES de criar Transaction/decrementar saldo.
    let ligada = false
    let payable
    try {
    payable = await prisma.$transaction(async (tx) => {
      // Onda 4 (§7): ordem única de travas — a conta bancária (accounts) primeiro, depois a AP; só então candidatos
      // e escritas (o livro/linhas trava a mesma conta antes de lançar a linha do banco).
      await travarContas(tx, user.companyId, [data.account_id])
      await tx.$queryRaw`SELECT id FROM accounts_payable WHERE id = ${params.id} AND company_id = ${user.companyId} FOR UPDATE`
      const fresh = await tx.accountPayable.findFirst({
        where: { id: params.id, company_id: user.companyId, deleted_at: null },
      })
      if (!fresh) throw new ConflitoBaixa('conta não encontrada durante a baixa')
      if (fresh.status === 'PAGO') throw new ConflitoBaixa('esta conta acabou de ser paga por outra pessoa — recarregue')
      if (fresh.status === 'CANCELADO') throw new ConflitoBaixa('Conta cancelada durante a baixa')
      const previousPaid = fresh.paid_amount || 0
      const restante = fresh.total_amount - previousPaid

      // Livro-razão: se a saída já foi lançada pelo banco, liga a ela (decide antes de escrever).
      const dataBaixa = data.paid_at ? new Date(data.paid_at).toISOString().slice(0, 10) : hojeSP()
      const candidatos = await candidatosLivro(tx, user.companyId, data.account_id, 'DEBIT', dataBaixa, data.livro_transaction_id ?? null, JANELA_BAIXA)

      // F6: vínculo explícito com linha a até R$ 1 do restante quita a AP por inteiro (paid = restante);
      // a diferença bancária fica registrada nas notes da AP.
      const linhaExplicita = data.livro_transaction_id ? candidatos.find((c) => c.id === data.livro_transaction_id) : undefined
      // Onda 3 (E8): o valor informado também tem de bater com a linha escolhida (até R$ 1) — senão a quitação
      // pelo vínculo sobreporia em silêncio o valor que o usuário digitou.
      if (linhaExplicita && Math.abs(data.paid_amount - linhaExplicita.amount) > TOLERANCIA_EXPLICITO) {
        throw new LivroInvalido('valor informado difere da linha do banco')
      }
      const quitaPeloVinculo = !!linhaExplicita && Math.abs(linhaExplicita.amount - restante) <= TOLERANCIA_EXPLICITO
      const valorBaixa = quitaPeloVinculo ? restante : data.paid_amount
      const diferencaBancaria = quitaPeloVinculo ? Math.abs(linhaExplicita!.amount - restante) : 0

      const newPaidTotal = previousPaid + valorBaixa
      // Bug #53 (audit 31/05): baixa com valor > total causava 500 (overflow).
      // Cap em total_amount — qualquer excedente vira erro 400 com mensagem clara.
      if (newPaidTotal > fresh.total_amount) {
        throw new ValorExcedeRestante(`Valor da baixa (R$ ${(data.paid_amount/100).toFixed(2)}) excede o saldo restante (R$ ${((fresh.total_amount - previousPaid)/100).toFixed(2)})`)
      }
      // Onda 3 (G1) com a trava: outra baixa comitou enquanto esta esperava (duplo clique) — o valor relido já não é
      // o que o usuário viu; não soma uma segunda baixa por cima.
      if (previousPaid !== (existing.paid_amount || 0)) {
        throw new ConflitoBaixa('Baixa concorrente detectada — esta conta já foi paga por outra requisição')
      }
      const isPaidInFull = newPaidTotal >= fresh.total_amount

      const categoriaAP = await nomeCategoria(tx, user.companyId, fresh.category_id)
      const decisao = decidirBaixa({ tipo: 'DEBIT', amount: valorBaixa, data: dataBaixa, categoria: categoriaAP }, data.livro_transaction_id ?? null, candidatos, JANELA_BAIXA)
      if ('erro' in decisao) throw new LivroInvalido(decisao.erro)
      // Onda 4 (§6, #14): AP sem categoria ligada a linha já categorizada (ex.: regra ELETROPAULO → Energia) recebe a categoria da linha.
      const linhaUsada = 'usar' in decisao ? candidatos.find((c) => c.id === decisao.usar) : undefined
      const categoriaDaLinha = !fresh.category_id && linhaUsada && !recebeCategoria(linhaUsada.categoria) ? linhaUsada.category_id : null
      const notaDiferenca = diferencaBancaria > 0
        ? `diferença bancária de R$ ${(diferencaBancaria / 100).toFixed(2).replace('.', ',')}`
        : null

      // Guard atomic: só roda se ainda não estiver PAGO. updateMany retorna
      // count=0 se outra tx concorrente já marcou PAGO entre nosso findFirst
      // e este update — isso é o sinal pra abortar sem efeitos colaterais.
      const claim = await tx.accountPayable.updateMany({
        where: {
          id: params.id,
          company_id: user.companyId,
          status: { notIn: ['PAGO', 'CANCELADO'] },
          deleted_at: null,
          // Onda 3 (G1): só vence se o valor pago ainda é o relido — duas baixas parciais concorrentes
          // (duplo clique) ficam PENDENTE e passariam as duas pelo status; a 2ª dá count 0 → 409.
          ...(previousPaid === 0 ? { OR: [{ paid_amount: 0 }, { paid_amount: null }] } : { paid_amount: previousPaid }),
        },
        data: {
          paid_amount: newPaidTotal,
          status: isPaidInFull ? 'PAGO' : 'PENDENTE',
          payment_method: fresh.payment_method,
          // E5: AP sem conta ganha a da baixa (o estorno compensa pela conta do próprio DEBIT, não por esta).
          ...(fresh.account_id ? {} : { account_id: data.account_id }),
          ...(categoriaDaLinha ? { category_id: categoriaDaLinha } : {}),
          ...(notaDiferenca ? { notes: fresh.notes ? `${fresh.notes} — ${notaDiferenca}` : notaDiferenca } : {}),
          updated_at: new Date(),
        },
      })
      if (claim.count === 0) {
        throw new ConflitoBaixa('Baixa concorrente detectada — esta conta já foi paga por outra requisição')
      }

      const updated = await tx.accountPayable.findFirstOrThrow({
        where: { id: params.id, company_id: user.companyId },
      })

      // account_id e obrigatorio (schema), entao SEMPRE criamos Transaction
      // e debitamos saldo. C1 fix: bank_ref + reconciled=true marca a Transaction
      // como ja conciliada com o lancamento — quando OFX importar a mesma
      // transferencia, dedup por bank_ref evita DOUBLE COUNT do saldo.
      if ('usar' in decisao) {
        // Liga ao lançamento do livro: o saldo já foi movido pelo banco — NÃO cria transação nem mexe na conta.
        const alvo = await tx.transaction.findFirst({
          where: { id: decisao.usar, company_id: user.companyId },
          select: { source_text: true },
        })
        // Linha já categorizada (ex.: regra ELETROPAULO → Energia) mantém a sua categoria.
        const linha = candidatos.find((c) => c.id === decisao.usar)
        const trocaCategoria = !!fresh.category_id && recebeCategoria(linha?.categoria ?? null)
        // Guard atômico (como Bug #41/#67): só liga se a linha ainda estiver livre.
        const ligou = await tx.transaction.updateMany({
          where: { id: decisao.usar, company_id: user.companyId, linked_ref: null },
          data: {
            linked_ref: `AP:${params.id}`,
            // sem categoria na AP → mantém a atual ("A classificar")
            ...(trocaCategoria ? { category_id: fresh.category_id } : {}),
            description: `Pgto: ${fresh.description} · banco: ${alvo?.source_text ?? ''}`,
            reconciled: true,
          },
        })
        if (ligou.count === 0) throw new LivroJaLigado()
        ligada = true
        return { updated, previousPaid, newPaidTotal }
      }

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
    }, { maxWait: 10000, timeout: 20000 })
    } catch (e) {
      if (e instanceof LivroInvalido) return error(e.message, 422)
      if (e instanceof LivroJaLigado) return error('lançamento do livro já ligado por outra baixa', 409)
      if (e instanceof ValorExcedeRestante) return error(e.message, 400)
      if (e instanceof ConflitoBaixa) return error(e.message, e.status)
      throw e
    }

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

    return success({ ...payableData, ligada })
  } catch (err) {
    return handleError(err)
  }
}
