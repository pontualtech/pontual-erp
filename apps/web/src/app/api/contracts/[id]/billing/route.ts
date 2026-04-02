import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('contratos', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const contract = await prisma.contract.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { customers: { select: { id: true, legal_name: true } } },
    })
    if (!contract) return error('Contrato não encontrado', 404)
    if (contract.status !== 'ACTIVE') return error('Contrato não está ativo')
    if (!contract.monthly_value || contract.monthly_value <= 0) return error('Contrato sem valor mensal definido')

    const body = await req.json()
    const referenceMonth = body.reference_month // e.g. "2026-04"

    if (!referenceMonth) return error('Mês de referência é obrigatório (YYYY-MM)')

    // Parse reference month to build due date
    const [year, month] = referenceMonth.split('-').map(Number)
    const billingDay = contract.billing_day || 1
    const dueDate = new Date(year, month - 1, Math.min(billingDay, 28)) // cap at 28 to avoid invalid dates

    // Check if billing already exists for this month
    const existingDescription = `Contrato ${contract.number || contract.id.slice(0, 8)} - ${referenceMonth}`
    const existing = await prisma.accountReceivable.findFirst({
      where: {
        company_id: user.companyId,
        customer_id: contract.customer_id,
        description: existingDescription,
      },
    })
    if (existing) return error(`Faturamento já gerado para ${referenceMonth}`)

    const ar = await prisma.accountReceivable.create({
      data: {
        company_id: user.companyId,
        customer_id: contract.customer_id,
        description: existingDescription,
        total_amount: contract.monthly_value,
        due_date: dueDate,
        status: 'PENDENTE',
        notes: `Gerado automaticamente do contrato ${contract.number || ''} - Cliente: ${contract.customers.legal_name}`,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'contratos',
      action: 'generate_billing',
      entityId: params.id,
      newValue: { ar_id: ar.id, month: referenceMonth, amount: contract.monthly_value },
    })

    return success(ar, 201)
  } catch (err) {
    return handleError(err)
  }
}
