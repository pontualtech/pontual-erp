import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// POST /api/financeiro/conciliacao/match
// Confirm reconciliation between a bank transaction and a payable/receivable
// ---------------------------------------------------------------------------

const matchSchema = z.object({
  transaction_id: z.string().min(1, 'transaction_id e obrigatorio'),
  type: z.enum(['payable', 'receivable', 'ignore']),
  record_id: z.string().optional(),
})

const bulkMatchSchema = z.object({
  matches: z.array(z.object({
    transaction_id: z.string().min(1),
    type: z.enum(['payable', 'receivable']),
    record_id: z.string().min(1),
  })).min(1, 'Pelo menos um match e necessario'),
})

const undoSchema = z.object({
  transaction_id: z.string().min(1, 'transaction_id e obrigatorio'),
})

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = matchSchema.parse(body)

    // Validate transaction exists and belongs to company
    const transaction = await prisma.transaction.findFirst({
      where: {
        id: data.transaction_id,
        company_id: user.companyId,
      },
    })
    if (!transaction) return error('Transacao nao encontrada', 404)
    if (transaction.reconciled) return error('Transacao ja foi conciliada', 400)

    // Handle "ignore" — mark as reconciled without linking to any record
    if (data.type === 'ignore') {
      await prisma.transaction.update({
        where: { id: data.transaction_id },
        data: { reconciled: true },
      })

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'financeiro',
        action: 'conciliacao.ignore',
        entityId: data.transaction_id,
        newValue: {
          description: transaction.description,
          amount: transaction.amount,
        },
      })

      return success({
        transaction_id: data.transaction_id,
        reconciled: true,
        action: 'ignored',
      })
    }

    if (!data.record_id) return error('record_id e obrigatorio para conciliacao', 400)

    const absAmount = Math.abs(transaction.amount)

    // C5 fix (audit): POST agora envolve os 2 updates em $transaction.
    // Antes: update AR/AP fora de tx + update transaction fora de tx → se o
    // segundo crashasse (network/timeout/FK), AR ficaria com received_amount
    // aumentado mas transaction não viraria reconciled, abrindo dupla
    // contagem na próxima rodada.
    if (data.type === 'payable') {
      const payable = await prisma.accountPayable.findFirst({
        where: {
          id: data.record_id,
          company_id: user.companyId,
          deleted_at: null,
        },
      })
      if (!payable) return error('Conta a pagar nao encontrada', 404)
      if (payable.status === 'PAGO') return error('Conta a pagar ja esta paga', 400)
      if (payable.status === 'CANCELADO') return error('Conta a pagar cancelada', 400)

      const previousPaid = payable.paid_amount || 0
      const newPaidTotal = previousPaid + absAmount
      const isPaidInFull = newPaidTotal >= payable.total_amount

      await prisma.$transaction(async (tx) => {
        await tx.accountPayable.update({
          where: { id: data.record_id, company_id: user.companyId },
          data: {
            paid_amount: newPaidTotal,
            status: isPaidInFull ? 'PAGO' : 'PENDENTE',
            updated_at: new Date(),
          },
        })
        await tx.transaction.update({
          where: { id: data.transaction_id, company_id: user.companyId },
          data: { reconciled: true },
        })
      })

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'financeiro',
        action: 'conciliacao.match',
        entityId: data.transaction_id,
        newValue: {
          type: 'payable',
          record_id: data.record_id,
          amount: absAmount,
          payable_description: payable.description,
          previous_paid: previousPaid,
          new_paid_total: newPaidTotal,
          new_status: isPaidInFull ? 'PAGO' : 'PENDENTE',
        },
      })

      return success({
        transaction_id: data.transaction_id,
        reconciled: true,
        payable_id: data.record_id,
        payable_status: isPaidInFull ? 'PAGO' : 'PENDENTE',
        paid_total: newPaidTotal,
      })
    } else {
      const receivable = await prisma.accountReceivable.findFirst({
        where: {
          id: data.record_id,
          company_id: user.companyId,
          deleted_at: null,
        },
      })
      if (!receivable) return error('Conta a receber nao encontrada', 404)
      if (receivable.status === 'RECEBIDO') return error('Conta a receber ja foi recebida', 400)
      if (receivable.status === 'CANCELADO') return error('Conta a receber cancelada', 400)

      const previousReceived = receivable.received_amount || 0
      const newReceivedTotal = previousReceived + absAmount
      const isReceivedInFull = newReceivedTotal >= receivable.total_amount

      await prisma.$transaction(async (tx) => {
        await tx.accountReceivable.update({
          where: { id: data.record_id, company_id: user.companyId },
          data: {
            received_amount: newReceivedTotal,
            status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
            updated_at: new Date(),
          },
        })
        await tx.transaction.update({
          where: { id: data.transaction_id, company_id: user.companyId },
          data: { reconciled: true },
        })
      })

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'financeiro',
        action: 'conciliacao.match',
        entityId: data.transaction_id,
        newValue: {
          type: 'receivable',
          record_id: data.record_id,
          amount: absAmount,
          receivable_description: receivable.description,
          previous_received: previousReceived,
          new_received_total: newReceivedTotal,
          new_status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
        },
      })

      return success({
        transaction_id: data.transaction_id,
        reconciled: true,
        receivable_id: data.record_id,
        receivable_status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE',
        received_total: newReceivedTotal,
      })
    }
  } catch (err) {
    return handleError(err)
  }
}

// ---------------------------------------------------------------------------
// PUT /api/financeiro/conciliacao/match  — Bulk reconcile multiple matches
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = bulkMatchSchema.parse(body)

    const results: { transaction_id: string; success: boolean; error?: string }[] = []

    for (const match of data.matches) {
      try {
        const transaction = await prisma.transaction.findFirst({
          where: { id: match.transaction_id, company_id: user.companyId },
        })
        if (!transaction) {
          results.push({ transaction_id: match.transaction_id, success: false, error: 'Transacao nao encontrada' })
          continue
        }
        if (transaction.reconciled) {
          results.push({ transaction_id: match.transaction_id, success: false, error: 'Ja conciliada' })
          continue
        }

        const absAmount = Math.abs(transaction.amount)

        if (match.type === 'payable') {
          const payable = await prisma.accountPayable.findFirst({
            where: { id: match.record_id, company_id: user.companyId, deleted_at: null },
          })
          if (!payable || payable.status === 'PAGO' || payable.status === 'CANCELADO') {
            results.push({ transaction_id: match.transaction_id, success: false, error: 'Conta a pagar invalida' })
            continue
          }

          const previousPaid = payable.paid_amount || 0
          const newPaidTotal = previousPaid + absAmount
          const isPaidInFull = newPaidTotal >= payable.total_amount

          await prisma.$transaction([
            prisma.accountPayable.update({
              where: { id: match.record_id },
              data: { paid_amount: newPaidTotal, status: isPaidInFull ? 'PAGO' : 'PENDENTE', updated_at: new Date() },
            }),
            prisma.transaction.update({
              where: { id: match.transaction_id },
              data: { reconciled: true },
            }),
          ])
        } else {
          const receivable = await prisma.accountReceivable.findFirst({
            where: { id: match.record_id, company_id: user.companyId, deleted_at: null },
          })
          if (!receivable || receivable.status === 'RECEBIDO' || receivable.status === 'CANCELADO') {
            results.push({ transaction_id: match.transaction_id, success: false, error: 'Conta a receber invalida' })
            continue
          }

          const previousReceived = receivable.received_amount || 0
          const newReceivedTotal = previousReceived + absAmount
          const isReceivedInFull = newReceivedTotal >= receivable.total_amount

          await prisma.$transaction([
            prisma.accountReceivable.update({
              where: { id: match.record_id },
              data: { received_amount: newReceivedTotal, status: isReceivedInFull ? 'RECEBIDO' : 'PENDENTE', updated_at: new Date() },
            }),
            prisma.transaction.update({
              where: { id: match.transaction_id },
              data: { reconciled: true },
            }),
          ])
        }

        results.push({ transaction_id: match.transaction_id, success: true })

        logAudit({
          companyId: user.companyId,
          userId: user.id,
          module: 'financeiro',
          action: 'conciliacao.bulk_match',
          entityId: match.transaction_id,
          newValue: { type: match.type, record_id: match.record_id },
        })
      } catch {
        results.push({ transaction_id: match.transaction_id, success: false, error: 'Erro interno' })
      }
    }

    const succeeded = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    return success({ results, summary: { succeeded, failed, total: data.matches.length } })
  } catch (err) {
    return handleError(err)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/financeiro/conciliacao/match  — Undo reconciliation
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = undoSchema.parse(body)

    const transaction = await prisma.transaction.findFirst({
      where: { id: data.transaction_id, company_id: user.companyId },
    })
    if (!transaction) return error('Transacao nao encontrada', 404)
    if (!transaction.reconciled) return error('Transacao nao esta conciliada', 400)

    // C4 fix (audit): UNDO agora reverte received_amount/paid_amount no AR/AP
    // ligado, dentro de $transaction. Antes, só desmarcava reconciled=false e
    // deixava o valor inflado no AR/AP — usuário fazia undo, conciliava de
    // novo e o valor batia 2x (double-counting silencioso).
    //
    // Estratégia: query do auditLog do match anterior (action='conciliacao.match'
    // ou 'conciliacao.bulk_match' com mesmo entity_id) pra recuperar type +
    // record_id + amount. Se não encontrar audit (legado pré-fix), só desmarca
    // reconciled e adiciona warning no audit do undo (sem reverter valor).
    const lastMatch = await prisma.auditLog.findFirst({
      where: {
        company_id: user.companyId,
        entity_id: data.transaction_id,
        action: { in: ['conciliacao.match', 'conciliacao.bulk_match'] },
      },
      orderBy: { created_at: 'desc' },
    })

    let revertedAmount: number | null = null
    let revertedTarget: { type: string; record_id: string; status: string } | null = null
    let warningNote: string | null = null

    const matchMeta = lastMatch?.new_value as any
    if (matchMeta?.type && matchMeta?.record_id && typeof matchMeta?.amount === 'number') {
      // Caso normal: temos info do match anterior, reverte com decrement.
      const targetType = matchMeta.type as 'payable' | 'receivable'
      const recordId = matchMeta.record_id as string
      const matchAmount = matchMeta.amount as number

      await prisma.$transaction(async (tx) => {
        if (targetType === 'payable') {
          // Re-busca dentro da tx pra evitar TOCTOU
          const payable = await tx.accountPayable.findFirst({
            where: { id: recordId, company_id: user.companyId, deleted_at: null },
          })
          if (payable) {
            const newPaidAmount = Math.max(0, (payable.paid_amount || 0) - matchAmount)
            const newStatus = newPaidAmount >= payable.total_amount ? 'PAGO' : 'PENDENTE'
            await tx.accountPayable.update({
              where: { id: recordId, company_id: user.companyId },
              data: {
                paid_amount: newPaidAmount,
                status: newStatus,
                updated_at: new Date(),
              },
            })
            revertedTarget = { type: 'payable', record_id: recordId, status: newStatus }
            revertedAmount = matchAmount
          } else {
            warningNote = 'AP referenciado no match anterior não encontrado/deletado; só desconciliou'
          }
        } else if (targetType === 'receivable') {
          const receivable = await tx.accountReceivable.findFirst({
            where: { id: recordId, company_id: user.companyId, deleted_at: null },
          })
          if (receivable) {
            const newReceivedAmount = Math.max(0, (receivable.received_amount || 0) - matchAmount)
            const newStatus = newReceivedAmount >= receivable.total_amount ? 'RECEBIDO' : 'PENDENTE'
            await tx.accountReceivable.update({
              where: { id: recordId, company_id: user.companyId },
              data: {
                received_amount: newReceivedAmount,
                status: newStatus,
                updated_at: new Date(),
              },
            })
            revertedTarget = { type: 'receivable', record_id: recordId, status: newStatus }
            revertedAmount = matchAmount
          } else {
            warningNote = 'AR referenciado no match anterior não encontrado/deletado; só desconciliou'
          }
        }
        await tx.transaction.update({
          where: { id: data.transaction_id, company_id: user.companyId },
          data: { reconciled: false },
        })
      })
    } else {
      // Fallback legado: sem audit do match anterior (pré-fix), só desmarca.
      warningNote = 'Match anterior sem auditoria — só desmarcou reconciled. Verificar AR/AP manualmente.'
      await prisma.transaction.update({
        where: { id: data.transaction_id, company_id: user.companyId },
        data: { reconciled: false },
      })
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'conciliacao.undo',
      entityId: data.transaction_id,
      newValue: {
        description: transaction.description,
        amount: transaction.amount,
        reverted_amount: revertedAmount,
        reverted_target: revertedTarget,
        warning: warningNote,
        previous_match_audit_id: lastMatch?.id ?? null,
      },
    })

    return success({
      transaction_id: data.transaction_id,
      reconciled: false,
      action: 'undone',
      reverted: revertedTarget,
      reverted_amount: revertedAmount,
      warning: warningNote,
    })
  } catch (err) {
    return handleError(err)
  }
}
