import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { refsCreditoAdquirente } from '@/lib/acquirer/match-rules'
import { decidirBaixa } from '@/lib/financeiro/livro-baixa'
import { candidatosLivro, categoriaId, hojeSP } from '@/lib/financeiro/livro-baixa-db'
import { CATEGORIA_RECEITA_SERVICOS } from '@/lib/financeiro/livro-categorias'

// Lançamento do livro foi ligado por outra baixa concorrente → desfaz a $transaction desta AR.
class LivroJaLigado extends Error {}

/**
 * Wave S (audit 2026-05-24): POST /api/financeiro/contas-receber/bulk-reconcile
 *
 * Karlão pediu: filtro + bulk reconcile pra não abrir uma a uma. Operador
 * marca várias contas como conciliadas (após conferir extrato bancário) de
 * uma vez só.
 *
 * Body: { ids: string[], reconciled: boolean, livro?: Record<arId, transactionId> }
 * 30/10 (livro-razão): se a linha do banco já está no livro (origin BANCO, categoria fallback),
 * a baixa LIGA a ela (linked_ref) em vez de criar outra transação — saldo não muda.
 * - reconciled=true → status vira LIQUIDADO + cria Transaction CREDIT + balance++
 * - reconciled=false → desfaz: status volta pra RECEBIDO + reverte Transaction + balance--
 *
 * Regra Karlão (2026-06-02): "saldo só muda quando ADM confere no banco".
 * RECEBIDO = alegação (cliente/funcionário disse). LIQUIDADO = ADM conferiu
 * no extrato. Saldo só é atualizado na transição RECEBIDO → LIQUIDADO.
 * Asaas/webhooks continuam liquidando direto via webhook (banco já confirma).
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const { ids, reconciled, livro } = body as { ids?: string[]; reconciled?: boolean; livro?: Record<string, string> }

    if (!Array.isArray(ids) || ids.length === 0) {
      return error('ids é obrigatório (array não vazio)', 400)
    }
    if (typeof reconciled !== 'boolean') {
      return error('reconciled é obrigatório (boolean true/false)', 400)
    }
    if (ids.length > 200) {
      return error('Máximo 200 itens por operação', 400)
    }

    // Busca ARs c/ account_id e received_amount pra atualizar saldos atomicamente.
    const arsToProcess = await prisma.accountReceivable.findMany({
      where: { id: { in: ids }, company_id: user.companyId, deleted_at: null },
      select: { id: true, account_id: true, received_amount: true, total_amount: true, status: true, description: true, category_id: true },
    })

    let updated = 0
    let ligadas = 0
    const erros: { ar: string; motivo: string }[] = []
    let balanceDelta = 0  // pra retornar ao frontend confirmando o impacto

    // Loop por AR — cada uma com seu próprio account_id e amount.
    // $transaction atomic dentro do loop garante AR + Transaction + balance
    // são sempre consistentes pra cada AR individualmente.
    for (const ar of arsToProcess) {
      const amount = ar.received_amount || ar.total_amount
      if (!amount) continue

      // 2026-06-03 fix (OS 60548): ARs antigas/portal sem account_id não conseguiam
      // ser desfeitas porque o loop pulava silenciosamente (updated=0).
      // Fix: quando account_id=null, só flipa flag+status (sem Transaction nem balance —
      // não havia o que reverter, pois nunca afetou conta bancária).
      if (!ar.account_id) {
        await prisma.accountReceivable.update({
          where: { id: ar.id, company_id: user.companyId },
          data: reconciled
            ? { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() }
            : { reconciled: false, status: 'RECEBIDO', updated_at: new Date() },
        })
        updated++
        continue
      }

      if (reconciled) {
        // RECEBIDO → LIQUIDADO: cria Transaction + incrementa saldo.
        // Idempotência: se já tem Transaction com bank_ref=AR:id, pula save.
        // 29/10: idem se a maquininha já creditou o LÍQUIDO desta AR (acquirer:<provider>:<NSU>) —
        // senão o "Conferi" somava o BRUTO por cima e o dinheiro contava 2x.
        const pagamentos = await prisma.payment.findMany({
          where: { company_id: user.companyId, receivable_id: ar.id },
          select: { provider: true, external_id: true },
        })
        const existing = await prisma.transaction.findFirst({
          where: { company_id: user.companyId, OR: [{ bank_ref: { in: [`AR:${ar.id}`, ...refsCreditoAdquirente(pagamentos)] } }, { linked_ref: `AR:${ar.id}` }] },
        })
        if (existing) {
          // Provavelmente já liquidada (ex: webhook Asaas, ou backfill manual).
          await prisma.accountReceivable.update({
            where: { id: ar.id, company_id: user.companyId },
            data: { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() },
          })
          updated++
          continue
        }

        let resultado: { erro?: string; ligada?: boolean }
        try {
          resultado = await prisma.$transaction(async (tx): Promise<{ erro?: string; ligada?: boolean }> => {
          // Decide ANTES de escrever: explícito inválido não baixa nada.
          const candidatos = await candidatosLivro(tx, user.companyId, ar.account_id!, 'CREDIT', hojeSP(), livro?.[ar.id] ?? null)
          const decisao = decidirBaixa({ tipo: 'CREDIT', amount, data: hojeSP() }, livro?.[ar.id] ?? null, candidatos)
          if ('erro' in decisao) return { erro: decisao.erro }

          const categoria = ar.category_id
            ?? await categoriaId(tx, user.companyId, CATEGORIA_RECEITA_SERVICOS, 'financeiro_receita')

          await tx.accountReceivable.update({
            where: { id: ar.id, company_id: user.companyId },
            data: { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() },
          })
          if ('usar' in decisao) {
            // Liga ao lançamento do livro: o dinheiro já está no saldo — NÃO cria transação nem mexe na conta.
            const alvo = await tx.transaction.findFirst({
              where: { id: decisao.usar, company_id: user.companyId },
              select: { source_text: true },
            })
            // Guard atômico (como Bug #41/#67): só liga se a linha ainda estiver livre.
            const ligou = await tx.transaction.updateMany({
              where: { id: decisao.usar, company_id: user.companyId, linked_ref: null },
              data: {
                linked_ref: `AR:${ar.id}`,
                category_id: categoria,
                description: `LIQUIDACAO: ${ar.description} · banco: ${alvo?.source_text ?? ''}`,
                reconciled: true,
              },
            })
            if (ligou.count === 0) throw new LivroJaLigado()
            return { ligada: true }
          }
          await tx.transaction.create({
            data: {
              company_id: user.companyId,
              account_id: ar.account_id!,
              transaction_type: 'CREDIT',
              amount,
              description: `LIQUIDACAO: ${ar.description}`,
              transaction_date: new Date(),
              bank_ref: `AR:${ar.id}`,
              category_id: categoria,
              reconciled: true,
            },
          })
          await tx.account.update({
            where: { id: ar.account_id! },
            data: { current_balance: { increment: amount }, updated_at: new Date() },
          })
          return { ligada: false }
        })
        } catch (e) {
          if (!(e instanceof LivroJaLigado)) throw e
          resultado = { erro: 'lançamento do livro já ligado por outra baixa' }
        }
        if (resultado.erro) {
          erros.push({ ar: ar.id, motivo: resultado.erro })
          continue
        }
        if (resultado.ligada) ligadas++
        else balanceDelta += amount
        updated++
      } else {
        // LIQUIDADO → RECEBIDO: reverte Transaction + decrementa saldo.
        const tx = await prisma.transaction.findFirst({
          where: { company_id: user.companyId, OR: [{ bank_ref: `AR:${ar.id}` }, { linked_ref: `AR:${ar.id}` }] },
        })
        // Lançamento do livro ligado: só desliga (volta ao fallback), sem apagar nem mexer no saldo.
        const ligado = tx?.linked_ref === `AR:${ar.id}`
        const fallback = ligado ? await categoriaId(prisma, user.companyId, 'Receita a identificar') : null

        await prisma.$transaction(async (txc) => {
          await txc.accountReceivable.update({
            where: { id: ar.id, company_id: user.companyId },
            data: { reconciled: false, status: 'RECEBIDO', updated_at: new Date() },
          })
          if (tx && ligado) {
            await txc.transaction.update({
              where: { id: tx.id },
              data: { linked_ref: null, category_id: fallback, description: tx.source_text ?? tx.description },
            })
          } else if (tx) {
            await txc.transaction.delete({ where: { id: tx.id } })
            await txc.account.update({
              where: { id: tx.account_id },
              data: { current_balance: { decrement: tx.amount }, updated_at: new Date() },
            })
            balanceDelta -= tx.amount
          }
        })
        updated++
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: reconciled ? 'bulk_reconcile' : 'bulk_unreconcile',
      entityId: ids.slice(0, 10).join(','), // primeiros 10 IDs no log
      newValue: { count: updated, reconciled, ids_total: ids.length, balance_delta: balanceDelta },
    })

    return success({
      updated,
      requested: ids.length,
      reconciled,
      balance_delta: balanceDelta,
      ligadas,
      erros,
    })
  } catch (err) {
    return handleError(err)
  }
}
