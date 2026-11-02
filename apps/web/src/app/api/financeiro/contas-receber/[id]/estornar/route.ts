import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import {
  alocarCompensacao, CONFLITO_BANCO, conflitoDeBanco, ContaAlterada, contasDaAR, descreverDinheiro, dinheiroDaAR, exigirTravadas, refsDaAR, travarContas,
  type LancamentoDaConta,
} from '@/lib/financeiro/livro-baixa-db'

/**
 * POST /api/financeiro/contas-receber/[id]/estornar
 *
 * C10 fix 22/05: estorno de AR ja recebida. Ordem de travas do §7 (contas → AR) e tudo relido dentro da tx.
 * Fix 8 (F8-A, §0): com dinheiro na conta (linhas do banco ligadas a qualquer ref dela, nocionais próprios vivos,
 * créditos do adquirente/Asaas/CNAB) o estorno PERGUNTA — sem `dinheiro` no corpo, 409 ESTORNO_PERGUNTA:
 *   'permanece' (engano/conta errada: o dinheiro continua no banco) → como em produção, DEBIT AR:<id>:estorno de
 *       exatamente o recebido (F9-A), alocado no dinheiro vivo (posterior ao ajuste primeiro) NA CONTA de cada dinheiro,
 *       sem desligar linhas (a linha continua mostrando a origem; o par se anula); sobra na conta da AR;
 *   'devolvido' (voltou para o cliente) → só status/valores; a saída da devolução chega pela linha do extrato — salvo o
 *       dinheiro em conta sem extrato (Caixa, sem AJUSTE), que é compensado (F9-B).
 * Sem dinheiro: legado (recebida antes de 22/05/2026, lançamento sem bank_ref) → DEBIT pelo received_amount na conta
 * da AR; senão só status/valores. PENDENTE sem valor recebido → 400 'nada a estornar'. Desligar linhas só no Desfazer.
 */
type Params = { params: { id: string } }

// Fix 8 (F8-A): a conta tem dinheiro e o operador não disse se ele voltou para o cliente ou continua no banco.
class PerguntaEstorno extends Error {
  constructor(readonly lancados: LancamentoDaConta[]) {
    super('O dinheiro deste recebimento voltou para o cliente, ou continua no banco (lançado na conta errada/por engano)?')
  }
}

// Recusa decidida na releitura com as travas: nada gravado.
class RecusaEstorno extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message)
  }
}

// Antes de 22/05/2026 (86c9e19b) a baixa criava o lançamento sem bank_ref: 22/05 00:00 em São Paulo.
const LEGADO_ATE = new Date('2026-05-22T03:00:00.000Z')

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const motivo = (body as any)?.motivo ? String((body as any).motivo).trim().slice(0, 500) : null
    const escolha = (body as any)?.dinheiro as unknown
    if (escolha !== undefined && escolha !== 'permanece' && escolha !== 'devolvido') {
      return error("dinheiro deve ser 'permanece' ou 'devolvido'", 400)
    }

    // Leitura de fora só para saber QUAIS contas travar; quem decide é a releitura dentro da tx.
    const lida = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true, account_id: true, pix_code: true },
    })
    if (!lida) return error('Conta a receber nao encontrada', 404)
    const contas = await contasDaAR(prisma, user.companyId, lida)

    let antes: { status: string | null; received_amount: number | null }
    try {
      antes = await prisma.$transaction(async (tx) => {
        const travadas = await travarContas(tx, user.companyId, contas)
        await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${params.id} AND company_id = ${user.companyId} FOR UPDATE`
        const ar = await tx.accountReceivable.findFirst({
          where: { id: params.id, company_id: user.companyId, deleted_at: null },
        })
        if (!ar) throw new RecusaEstorno('Conta a receber nao encontrada', 404)
        const quitada = ar.status === 'RECEBIDO' || ar.status === 'LIQUIDADO' || ar.status === 'PAGO'
        if (!quitada && ar.status !== 'PENDENTE') {
          throw new RecusaEstorno('Apenas ARs com status RECEBIDO/LIQUIDADO (ou PENDENTE com recebimento parcial) podem ser estornadas', 400)
        }

        const refs = await refsDaAR(tx, user.companyId, ar)
        const recebido = ar.received_amount ?? 0
        // Já estornada (ou nunca recebida): PENDENTE sem valor recebido.
        if (!quitada && recebido <= 0) throw new RecusaEstorno('nada a estornar', 400)

        // Fix 8 (F8-A, §0): o dinheiro da conta, líquido dos estornos anteriores. Com ele, pergunta.
        const dinheiro = await dinheiroDaAR(tx, user.companyId, ar)
        const compensar = new Map<string, number>()
        if (dinheiro.total > 0) {
          if (!escolha) throw new PerguntaEstorno(await descreverDinheiro(tx, user.companyId, dinheiro))
          // Fix 9 (F9-A): 'permanece' compensa EXATAMENTE o recebido (sem valor registrado: o dinheiro vivo), posterior ao
          // ajuste primeiro, depois o anterior — linhas, nocionais próprios, externos —, cada :estorno na conta do item; a
          // sobra sem item vai para a conta da AR (como produção). F9-B: 'devolvido' só compensa o dinheiro de conta sem
          // extrato (sem AJUSTE: a devolução nunca chega por extrato), sem sobra.
          const proprios = dinheiro.nocionais.filter((t) => t.bank_ref === refs.proprio || t.bank_ref === refs.antecipacao)
          const externos = dinheiro.nocionais.filter((t) => t.bank_ref !== refs.proprio && t.bank_ref !== refs.antecipacao)
          const { porConta, sobra } = await alocarCompensacao(
            tx, user.companyId, [dinheiro.linhas, proprios, externos], recebido > 0 ? recebido : dinheiro.total, escolha === 'devolvido',
          )
          for (const [conta, valor] of porConta) compensar.set(conta, valor)
          if (escolha === 'permanece' && sobra > 0 && ar.account_id) compensar.set(ar.account_id, (compensar.get(ar.account_id) ?? 0) + sobra)
        } else {
          // (c) legado: quitada antes de 22/05 com conta e valor, sem nenhum lançamento próprio nem linha ligada.
          // Fix 3/4 (F3-A, F4-A): (ii) sem dinheiro externo (garantido aqui: dinheiro.total = 0); (iii) conta criada antes de
          // 22/05; sem pagamento por fora (Asaas CONFIRMED/RECEIVED, adquirente); (iv) updated_at antigo OU a transação
          // legada DESTA AR — CREDIT do ERP sem bank_ref, do valor recebido, na conta da AR, antes de 22/05, com a
          // descrição exata da baixa antiga ('Recebimento: ' + descrição).
          const proprios = await tx.transaction.count({
            where: { company_id: user.companyId, OR: [{ bank_ref: { in: [refs.proprio, refs.antecipacao, refs.estorno] } }, { linked_ref: refs.proprio }] },
          })
          const candidataLegado = quitada && !!ar.account_id && recebido > 0 && proprios === 0
          const pagaPorFora = refs.pagamentos.some((p) =>
            (p.provider === 'asaas' && (p.status === 'CONFIRMED' || p.status === 'RECEIVED')) || p.provider === 'rede')
          const legado = candidataLegado && !pagaPorFora
            && !!ar.created_at && ar.created_at.getTime() < LEGADO_ATE.getTime()
            && (
              (!!ar.updated_at && ar.updated_at.getTime() < LEGADO_ATE.getTime())
              || (await tx.transaction.count({
                where: {
                  company_id: user.companyId, account_id: ar.account_id!, transaction_type: 'CREDIT', amount: recebido,
                  bank_ref: null, origin: null, created_at: { lt: LEGADO_ATE }, description: `Recebimento: ${ar.description}`,
                },
              })) > 0
            )
          if (legado) compensar.set(ar.account_id!, recebido)
          // Quitada sem valor, sem dinheiro e sem legado: nada a estornar.
          if (!legado && recebido <= 0) throw new RecusaEstorno('nada a estornar', 400)
        }

        exigirTravadas(travadas, [...compensar.keys()])

        for (const [contaId, valor] of compensar) {
          await tx.transaction.create({
            data: {
              company_id: user.companyId,
              account_id: contaId,
              transaction_type: 'DEBIT',
              amount: valor,
              description: `Estorno: ${ar.description}${motivo ? ` (${motivo})` : ''}`,
              transaction_date: new Date(),
              bank_ref: refs.estorno,
              reconciled: true,
            },
          })
          await tx.account.update({
            where: { id: contaId },
            data: { current_balance: { decrement: valor }, updated_at: new Date() },
          })
        }

        await tx.accountReceivable.update({
          where: { id: ar.id },
          data: { status: 'PENDENTE', received_amount: 0, reconciled: false, anticipated_at: null, updated_at: new Date() },
        })
        return { status: ar.status, received_amount: ar.received_amount }
      }, { maxWait: 10000, timeout: 20000 })
    } catch (e) {
      if (e instanceof RecusaEstorno) return error(e.message, e.status)
      if (e instanceof PerguntaEstorno) {
        return NextResponse.json({ code: 'ESTORNO_PERGUNTA', error: e.message, lancados: e.lancados }, { status: 409 })
      }
      if (e instanceof ContaAlterada) return error(e.message, 409)
      if (conflitoDeBanco(e)) return error(CONFLITO_BANCO, 409)
      throw e
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.estorno',
      entityId: params.id,
      oldValue: antes,
      newValue: { status: 'PENDENTE', received_amount: 0, motivo },
    })

    return success({ ok: true, receivable_id: params.id })
  } catch (err) {
    return handleError(err)
  }
}
