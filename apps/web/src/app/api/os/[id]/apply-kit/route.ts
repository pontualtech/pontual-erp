import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof Response) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true, diagnosis: true },
    })
    if (!os) return error('OS nao encontrada', 404)

    const body = await req.json()
    const { kit_id } = body
    if (!kit_id) return error('kit_id e obrigatorio')

    // Find the kit in settings
    const setting = await prisma.setting.findFirst({
      where: { company_id: user.companyId, key: kit_id },
    })
    if (!setting) return error('Kit nao encontrado', 404)

    let kitData: { name: string; laudo?: string; items: { description: string; unit_price: number; quantity: number; item_type: string; product_id?: string }[] }
    try {
      kitData = JSON.parse(setting.value)
    } catch {
      return error('Kit com formato invalido')
    }

    if (!kitData.items || kitData.items.length === 0) return error('Kit sem itens')

    // Atomic: insert items + recalc totals + auto-fill diagnosis
    const createdItems = await prisma.$transaction(async (tx) => {
      const items = []
      for (const kitItem of kitData.items) {
        const qty = kitItem.quantity || 1
        const unitPrice = kitItem.unit_price || 0
        const totalPrice = Math.round(qty * unitPrice)

        const item = await tx.serviceOrderItem.create({
          data: {
            company_id: user.companyId,
            service_order_id: params.id,
            item_type: kitItem.item_type || 'SERVICO',
            product_id: kitItem.product_id || null,
            description: kitItem.description,
            quantity: qty,
            unit_price: unitPrice,
            total_price: totalPrice,
          },
        })
        items.push(item)
      }

      // Recalculate OS totals
      const allItems = await tx.serviceOrderItem.findMany({
        where: { service_order_id: params.id, deleted_at: null },
      })
      const total_parts = allItems.filter(i => i.item_type === 'PECA').reduce((s, i) => s + i.total_price, 0)
      const total_services = allItems.filter(i => i.item_type !== 'PECA').reduce((s, i) => s + i.total_price, 0)
      const total_cost = allItems.reduce((s, i) => s + i.total_price, 0)

      // Update OS totals + auto-fill diagnosis from kit laudo (if provided and OS diagnosis is empty)
      const updateData: Record<string, any> = { total_parts, total_services, total_cost }
      if (kitData.laudo) {
        // Append kit laudo to existing diagnosis (don't overwrite)
        const currentDiagnosis = os.diagnosis || ''
        const separator = currentDiagnosis ? '\n\n---\n\n' : ''
        updateData.diagnosis = currentDiagnosis + separator + kitData.laudo
      }

      await tx.serviceOrder.update({
        where: { id: params.id, company_id: user.companyId },
        data: updateData,
      })

      return items
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'apply_kit',
      entityId: params.id,
      newValue: { kit_key: kit_id, kit_name: kitData.name, items_count: createdItems.length },
    })

    return success(createdItems, 201)
  } catch (err) {
    return handleError(err)
  }
}
