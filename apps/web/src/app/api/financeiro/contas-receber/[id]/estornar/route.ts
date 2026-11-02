import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import {
  ContaAlterada, contasDaAR, desligarLinhas, exigirTravadas, refsDaAR, SELECT_LINHA_LIGADA, travarContas,
} from '@/lib/financeiro/livro-baixa-db'

/**
 * POST /api/financeiro/contas-receber/[id]/estornar
 *
 * C10 fix 22/05: estorno de AR ja recebida. Onda 4 (§3, modelo único do dinheiro do banco), com a ordem de
 * travas do §7 (contas → AR) e tudo relido dentro da tx:
 *   (a) linhas do BANCO ligadas à ref própria AR:<id> (baixa ou CREDIT AR:<id> convertido) → DESLIGA (categoria da
 *       regra/fallback, texto do banco) — nunca apaga nem mexe em saldo; as de ref externa ficam ligadas (F2-B);
 *   (b) nocionais próprios ainda não convertidos (CREDIT AR:<id> e AR:<id>:anticipation) → DEBIT AR:<id>:estorno
 *       pelo líquido (próprios − estornos) NA CONTA de cada nocional; estornar antecipada = compensar a antecipação;
 *   (c) legado (recebida antes de 22/05/2026, lançamento sem bank_ref) → DEBIT pelo received_amount na conta da AR;
 *   (d) nada disso → só status/valores (recebimento sem lançamento próprio, ex.: adquirente/portal).
 * Conta já estornada (nada em a/b/c e sem valor recebido) → 400 'nada a estornar'.
 */
type Params = { params: { id: string } }

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
        // (a) linhas do banco ligadas pela ref PRÓPRIA da AR (baixa ou CREDIT AR:<id> convertido). Fix 2 (F2-B, #1): a linha
        // de ref externa (adquirente, Asaas, CNAB, antecipação) fica ligada — é o dinheiro daquele evento, e o dedupe dos
        // produtores (ondeRef) precisa continuar a achá-la; Receber/Conferir a reconhecem pelas refs da AR.
        const ligadas = await tx.transaction.findMany({
          where: { company_id: user.companyId, origin: 'BANCO', linked_ref: refs.proprio },
          select: SELECT_LINHA_LIGADA,
        })
        // (b) lançamentos próprios por bank_ref; nocional = ainda não convertido (sem origin nem texto do banco).
        const doAR = await tx.transaction.findMany({
          where: { company_id: user.companyId, bank_ref: { in: [refs.proprio, refs.antecipacao, refs.estorno] } },
          select: { amount: true, transaction_type: true, bank_ref: true, account_id: true, origin: true, source_text: true },
        })
        const compensar = new Map<string, number>()
        for (const t of doAR) {
          if (t.origin !== null || t.source_text !== null) continue
          const sinal = t.transaction_type === 'CREDIT' && (t.bank_ref === refs.proprio || t.bank_ref === refs.antecipacao) ? 1
            : t.transaction_type === 'DEBIT' && t.bank_ref === refs.estorno ? -1 : 0
          if (sinal !== 0) compensar.set(t.account_id, (compensar.get(t.account_id) ?? 0) + sinal * t.amount)
        }
        for (const [conta, valor] of compensar) if (valor <= 0) compensar.delete(conta)

        // (c) legado: quitada antes de 22/05 com conta e valor, sem nenhum lançamento próprio nem linha ligada.
        const recebido = ar.received_amount ?? 0
        const legado = quitada && !!ar.account_id && recebido > 0 && doAR.length === 0 && ligadas.length === 0
          && !!ar.updated_at && ar.updated_at.getTime() < LEGADO_ATE.getTime()
        if (legado) compensar.set(ar.account_id!, recebido)

        // Já estornada (ou nunca recebida): nada a desligar nem a compensar e nenhum valor a zerar.
        if (ligadas.length === 0 && compensar.size === 0 && recebido <= 0) throw new RecusaEstorno('nada a estornar', 400)

        exigirTravadas(travadas, [...ligadas.map((l) => l.account_id), ...compensar.keys()])

        await desligarLinhas(tx, user.companyId, ligadas)
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
      if (e instanceof ContaAlterada) return error(e.message, 409)
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
