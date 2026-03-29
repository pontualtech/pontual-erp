import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'
import { randomUUID } from 'crypto'

const agruparSchema = z.object({
  receivable_ids: z.array(z.string()).min(2, 'Selecione pelo menos 2 contas'),
  payment_method: z.string().optional(),
  notes: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const data = agruparSchema.parse(body)

    // Fetch all receivables
    const receivables = await prisma.accountReceivable.findMany({
      where: {
        id: { in: data.receivable_ids },
        company_id: user.companyId,
        deleted_at: null,
      },
    })

    // Validate all exist
    if (receivables.length !== data.receivable_ids.length) {
      return error('Uma ou mais contas nao foram encontradas', 404)
    }

    // Validate all are PENDENTE
    const nonPendente = receivables.filter(r => r.status !== 'PENDENTE')
    if (nonPendente.length > 0) {
      return error('Todas as contas devem estar com status PENDENTE para agrupar', 400)
    }

    // Validate none are already grouped
    const alreadyGrouped = receivables.filter(r => r.grouped_into_id)
    if (alreadyGrouped.length > 0) {
      return error('Uma ou mais contas ja estao agrupadas', 400)
    }

    // Calculate total
    const totalAmount = receivables.reduce((sum, r) => sum + r.total_amount, 0)

    // Build description from OS numbers or descriptions
    const descriptions = receivables.map(r => {
      const osMatch = r.description.match(/OS-\d+/)
      return osMatch ? osMatch[0] : r.description.substring(0, 30)
    })
    const groupDescription = `Agrupamento: ${descriptions.join(' + ')}`

    // Generate group_id
    const groupId = randomUUID()

    // Get payment method and customer
    const paymentMethod = data.payment_method || receivables[0].payment_method
    const firstCustomerId = receivables[0].customer_id
    const allSameCustomer = receivables.every(r => r.customer_id === firstCustomerId)
    const customerId = allSameCustomer ? firstCustomerId : null

    // Atomic transaction
    const grouped = await prisma.$transaction(async (tx) => {
      // Create the new grouped receivable
      const newReceivable = await tx.accountReceivable.create({
        data: {
          company_id: user.companyId,
          description: groupDescription,
          total_amount: totalAmount,
          received_amount: 0,
          status: 'PENDENTE',
          payment_method: paymentMethod,
          customer_id: customerId,
          group_id: groupId,
          due_date: new Date(Math.max(...receivables.map(r => new Date(r.due_date).getTime()))),
          notes: data.notes || `Agrupamento de ${receivables.length} contas`,
        },
      })

      // Update all original receivables
      await tx.accountReceivable.updateMany({
        where: { id: { in: data.receivable_ids } },
        data: {
          group_id: groupId,
          grouped_into_id: newReceivable.id,
          status: 'AGRUPADO',
          updated_at: new Date(),
        },
      })

      return newReceivable
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.agrupar',
      entityId: grouped.id,
      newValue: {
        group_id: groupId,
        receivable_ids: data.receivable_ids,
        total_amount: totalAmount,
        count: receivables.length,
      },
    })

    return success(grouped)
  } catch (err) {
    return handleError(err)
  }
}
