import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/financeiro/contas-pagar/[id]/estornar
 *
 * C10 fix 22/05: estorno de AP ja paga. Reverte:
 *   1. Marca AP como PENDENTE (paid_amount → 0)
 *   2. Cria Transaction CREDIT (reverte o DEBIT original) na mesma conta
 *   3. Atualiza current_balance (+= paid_amount)
 *
 * Antes, mexer em AP paga só era possível via DELETE (soft delete) que
 * deixava a Transaction DEBIT órfã + saldo deflacionado sem rastro.
 */
type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const motivo = (body as any)?.motivo ? String((body as any).motivo).trim().slice(0, 500) : null

    const existing = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a pagar nao encontrada', 404)
    if (existing.status !== 'PAGO') return error('Apenas APs com status PAGO podem ser estornadas', 400)
    if (!existing.account_id) return error('AP sem conta bancaria vinculada — nao da pra estornar saldo', 400)
    if (!existing.paid_amount || existing.paid_amount <= 0) return error('AP sem paid_amount valido', 400)

    await prisma.$transaction(async (tx: any) => {
      // Bug #67 (audit 31/05 LOOP r7): MESMA classe de #41 mas em /estornar!
      // 3 estornar concorrentes → 3 Transactions CREDIT criadas, saldo +3x
      // (testado: estornar 3x de R$ 0,50 → saldo subiu R$ 1,50 em vez de R$ 0,50).
      // Fix: updateMany com guard status='PAGO' (só primeira tx vence atomic).
      // Se claim=0, request perdeu race → throw antes de criar Transaction.
      const claim = await tx.accountPayable.updateMany({
        where: {
          id: params.id,
          company_id: user.companyId,
          status: 'PAGO',
          deleted_at: null,
        },
        data: {
          status: 'PENDENTE',
          paid_amount: 0,
          reconciled: false,
          updated_at: new Date(),
        },
      })
      if (claim.count === 0) {
        throw new Error('Estorno concorrente — outra requisição já estornou esta conta')
      }

      // 2. Criar Transaction CREDIT compensatoria (reverte o DEBIT original)
      //    bank_ref aponta pra "AP:{id}:estorno" pra distinguir do DEBIT original
      await tx.transaction.create({
        data: {
          company_id: user.companyId,
          account_id: existing.account_id!,
          transaction_type: 'CREDIT',
          amount: existing.paid_amount!,
          description: `Estorno: ${existing.description}${motivo ? ` (${motivo})` : ''}`,
          transaction_date: new Date(),
          bank_ref: `AP:${params.id}:estorno`,
          reconciled: true,
        },
      })

      // 3. Reverter saldo da conta
      await tx.account.update({
        where: { id: existing.account_id! },
        data: {
          current_balance: { increment: existing.paid_amount! },
          updated_at: new Date(),
        },
      })
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.estorno',
      entityId: params.id,
      oldValue: { status: 'PAGO', paid_amount: existing.paid_amount },
      newValue: { status: 'PENDENTE', paid_amount: 0, motivo },
    })

    return success({ ok: true, payable_id: params.id })
  } catch (err) {
    return handleError(err)
  }
}
