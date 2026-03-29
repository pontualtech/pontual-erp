import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const desagruparSchema = z.object({
  group_receivable_id: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const data = desagruparSchema.parse(body)

    // Find the grouped receivable
    const grouped = await prisma.accountReceivable.findFirst({
      where: {
        id: data.group_receivable_id,
        company_id: user.companyId,
        deleted_at: null,
        group_id: { not: null },
      },
    })

    if (!grouped) {
      return error('Conta agrupada nao encontrada', 404)
    }

    if (grouped.status === 'RECEBIDO') {
      return error('Nao e possivel desagrupar uma conta ja recebida', 400)
    }

    // Find all originals that point to this grouped receivable
    const originals = await prisma.accountReceivable.findMany({
      where: {
        grouped_into_id: grouped.id,
        company_id: user.companyId,
        deleted_at: null,
      },
    })

    if (originals.length === 0) {
      return error('Nenhuma conta original encontrada para desagrupar', 400)
    }

    // Atomic transaction
    await prisma.$transaction(async (tx) => {
      // Restore all originals
      await tx.accountReceivable.updateMany({
        where: { grouped_into_id: grouped.id },
        data: {
          status: 'PENDENTE',
          grouped_into_id: null,
          group_id: null,
          updated_at: new Date(),
        },
      })

      // Delete the grouped receivable (soft delete)
      await tx.accountReceivable.update({
        where: { id: grouped.id },
        data: { deleted_at: new Date() },
      })
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.desagrupar',
      entityId: grouped.id,
      oldValue: {
        group_id: grouped.group_id,
        original_ids: originals.map(o => o.id),
        total_amount: grouped.total_amount,
      },
    })

    return success({ message: 'Contas desagrupadas com sucesso', restored_count: originals.length })
  } catch (err) {
    return handleError(err)
  }
}
