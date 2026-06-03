import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * Wave S (audit 2026-05-24): POST /api/financeiro/contas-receber/bulk-reconcile
 *
 * Karlão pediu: filtro + bulk reconcile pra não abrir uma a uma. Operador
 * marca várias contas como conciliadas (após conferir extrato bancário) de
 * uma vez só.
 *
 * Body: { ids: string[], reconciled: boolean }
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
    const { ids, reconciled } = body as { ids?: string[]; reconciled?: boolean }

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
      select: { id: true, account_id: true, received_amount: true, total_amount: true, status: true, description: true },
    })

    let updated = 0
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
        const existing = await prisma.transaction.findFirst({
          where: { company_id: user.companyId, bank_ref: `AR:${ar.id}` },
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

        await prisma.$transaction(async (tx) => {
          await tx.accountReceivable.update({
            where: { id: ar.id, company_id: user.companyId },
            data: { reconciled: true, status: 'LIQUIDADO', updated_at: new Date() },
          })
          await tx.transaction.create({
            data: {
              company_id: user.companyId,
              account_id: ar.account_id!,
              transaction_type: 'CREDIT',
              amount,
              description: `LIQUIDACAO: ${ar.description}`,
              transaction_date: new Date(),
              bank_ref: `AR:${ar.id}`,
              reconciled: true,
            },
          })
          await tx.account.update({
            where: { id: ar.account_id! },
            data: { current_balance: { increment: amount }, updated_at: new Date() },
          })
        })
        balanceDelta += amount
        updated++
      } else {
        // LIQUIDADO → RECEBIDO: reverte Transaction + decrementa saldo.
        const tx = await prisma.transaction.findFirst({
          where: { company_id: user.companyId, bank_ref: `AR:${ar.id}` },
        })

        await prisma.$transaction(async (txc) => {
          await txc.accountReceivable.update({
            where: { id: ar.id, company_id: user.companyId },
            data: { reconciled: false, status: 'RECEBIDO', updated_at: new Date() },
          })
          if (tx) {
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
    })
  } catch (err) {
    return handleError(err)
  }
}
