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
    if (existing.status !== 'RECEBIDO') return error('Apenas ARs com status RECEBIDO podem ser estornadas', 400)
    if (!existing.account_id) return error('AR sem conta bancaria vinculada — nao da pra estornar saldo', 400)
    if (!existing.received_amount || existing.received_amount <= 0) return error('AR sem received_amount valido', 400)

    await prisma.$transaction(async (tx: any) => {
      await tx.accountReceivable.update({
        where: { id: params.id, company_id: user.companyId },
        data: {
          status: 'PENDENTE',
          received_amount: 0,
          // Wave Y: estorno desfaz a conciliação implícita da baixa.
          reconciled: false,
          updated_at: new Date(),
        },
      })

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
