import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('contratos', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Verify contract belongs to company
    const contract = await prisma.contract.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!contract) return error('Contrato não encontrado', 404)

    const equipment = await prisma.contractEquipment.findMany({
      where: { contract_id: params.id },
      orderBy: { created_at: 'asc' },
    })

    return success(equipment)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('contratos', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const contract = await prisma.contract.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!contract) return error('Contrato não encontrado', 404)

    const body = await req.json()

    const equipment = await prisma.contractEquipment.create({
      data: {
        contract_id: params.id,
        equipment_type: body.equipment_type || null,
        brand: body.brand || null,
        model: body.model || null,
        serial_number: body.serial_number || null,
        location: body.location || null,
        last_maintenance: body.last_maintenance ? new Date(body.last_maintenance) : null,
        next_maintenance: body.next_maintenance ? new Date(body.next_maintenance) : null,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'contratos',
      action: 'add_equipment',
      entityId: params.id,
      newValue: { equipment_id: equipment.id, type: equipment.equipment_type },
    })

    return success(equipment, 201)
  } catch (err) {
    return handleError(err)
  }
}
