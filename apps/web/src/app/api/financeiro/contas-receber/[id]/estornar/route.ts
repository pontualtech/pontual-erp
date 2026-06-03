import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/financeiro/contas-receber/[id]/estornar
 *
 * C10 fix 22/05: estorno de AR ja recebida. Reverte:
 *   1. Marca AR como PENDENTE (received_amount → 0)
 *   2. Cria Transaction DEBIT (reverte o CREDIT original) na mesma conta
 *   3. Atualiza current_balance (-= received_amount)
 */
type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const motivo = (body as any)?.motivo ? String((body as any).motivo).trim().slice(0, 500) : null

    const existing = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a receber nao encontrada', 404)
    if (existing.status !== 'RECEBIDO' && existing.status !== 'LIQUIDADO' && existing.status !== 'PAGO') return error('Apenas ARs com status RECEBIDO/LIQUIDADO podem ser estornadas', 400)
    if (!existing.received_amount || existing.received_amount <= 0) return error('AR sem received_amount valido', 400)

    // 2026-06-03 fix (OS 60548): ARs antigas/portal sem account_id podem ser estornadas
    // apenas no nível do status — não havia Transaction CREDIT nem balance afetado, então
    // nada pra reverter financeiramente. Antes: bloqueava com erro 400.
    const hasAccount = !!existing.account_id

    await prisma.$transaction(async (tx: any) => {
      // Bug #67 (audit 31/05 LOOP r7): race em estornar — mesma classe de #41.
      // Guard atomic com updateMany where status='RECEBIDO' (ou 'PAGO' defensivo).
      const claim = await tx.accountReceivable.updateMany({
        where: {
          id: params.id,
          company_id: user.companyId,
          status: { in: ['RECEBIDO', 'LIQUIDADO', 'PAGO'] },
          deleted_at: null,
        },
        data: {
          status: 'PENDENTE',
          received_amount: 0,
          reconciled: false,
          updated_at: new Date(),
        },
      })
      if (claim.count === 0) {
        throw new Error('Estorno concorrente — outra requisição já estornou esta conta')
      }

      if (hasAccount) {
        await tx.transaction.create({
          data: {
            company_id: user.companyId,
            account_id: existing.account_id!,
            transaction_type: 'DEBIT',
            amount: existing.received_amount!,
            description: `Estorno: ${existing.description}${motivo ? ` (${motivo})` : ''}`,
            transaction_date: new Date(),
            bank_ref: `AR:${params.id}:estorno`,
            reconciled: true,
          },
        })

        await tx.account.update({
          where: { id: existing.account_id! },
          data: {
            current_balance: { decrement: existing.received_amount! },
            updated_at: new Date(),
          },
        })
      }
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.estorno',
      entityId: params.id,
      oldValue: { status: 'RECEBIDO', received_amount: existing.received_amount },
      newValue: { status: 'PENDENTE', received_amount: 0, motivo },
    })

    return success({ ok: true, receivable_id: params.id })
  } catch (err) {
    return handleError(err)
  }
}
