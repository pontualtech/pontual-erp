import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const receivable = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!receivable) return error('Conta a receber nao encontrada', 404)

    // Only card receivables can be anticipated
    const pm = (receivable.payment_method || '').toLowerCase()
    if (!pm.includes('cartão') && !pm.includes('cartao') && !pm.includes('credito') && !pm.includes('crédito')) {
      return error('Antecipação disponível apenas para recebíveis de cartão', 400)
    }

    if (receivable.status === 'RECEBIDO') return error('Conta já foi recebida', 400)
    if (receivable.status === 'CANCELADO') return error('Conta cancelada', 400)
    if (receivable.anticipated_at) return error('Conta já foi antecipada', 400)

    // Load card fee config to get anticipation rate
    const cardFeeSettings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { startsWith: 'card_fee.' } },
    })

    let feePctPerDay = 0.04 // default
    for (const setting of cardFeeSettings) {
      try {
        const config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
        if (config?.anticipation?.enabled && config?.anticipation?.fee_pct_per_day) {
          feePctPerDay = config.anticipation.fee_pct_per_day
          break
        }
      } catch {
        // skip malformed settings
      }
    }

    // Get pending installments
    const installments = await prisma.installment.findMany({
      where: {
        parent_type: 'RECEIVABLE',
        parent_id: receivable.id,
        status: 'PENDENTE',
      },
      orderBy: { installment_number: 'asc' },
    })

    if (installments.length === 0) {
      return error('Nenhuma parcela pendente para antecipar', 400)
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Calculate anticipation fee per installment
    const installmentDetails = installments.map((inst) => {
      const dueDate = new Date(inst.due_date)
      dueDate.setHours(0, 0, 0, 0)
      const diffMs = dueDate.getTime() - today.getTime()
      const daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
      const fee = Math.round(inst.amount * (feePctPerDay / 100) * daysRemaining)
      const net = inst.amount - fee

      return {
        number: inst.installment_number,
        amount: inst.amount,
        days_remaining: daysRemaining,
        fee,
        net,
        id: inst.id,
      }
    })

    const totalAmount = installmentDetails.reduce((s, i) => s + i.amount, 0)
    const totalFee = installmentDetails.reduce((s, i) => s + i.fee, 0)
    const anticipatedAmount = totalAmount - totalFee

    const body = await req.json().catch(() => ({}))

    if (!body.confirm) {
      // Preview mode — return calculation without modifying anything
      return success({
        installments: installmentDetails.map(({ id: _id, ...rest }) => rest),
        total_amount: totalAmount,
        total_fee: totalFee,
        anticipated_amount: anticipatedAmount,
        fee_pct_per_day: feePctPerDay,
      })
    }

    // Confirm mode — execute anticipation atomically
    const now = new Date()

    const updated = await prisma.$transaction(async (tx) => {
      // Mark all pending installments as received with fee deducted
      for (const inst of installmentDetails) {
        await tx.installment.update({
          where: { id: inst.id },
          data: {
            status: 'RECEBIDO',
            paid_at: now,
            paid_amount: inst.net,
          },
        })
      }

      // Update receivable
      return tx.accountReceivable.update({
        where: { id: params.id, company_id: user.companyId },
        data: {
          status: 'RECEBIDO',
          received_amount: anticipatedAmount,
          anticipated_at: now,
          anticipation_fee: totalFee,
          anticipated_amount: anticipatedAmount,
          updated_at: now,
        },
      })
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.anticipation',
      entityId: receivable.id,
      oldValue: {
        status: receivable.status,
        received_amount: receivable.received_amount,
      },
      newValue: {
        status: 'RECEBIDO',
        anticipated_amount: anticipatedAmount,
        anticipation_fee: totalFee,
        installments_count: installmentDetails.length,
      },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
