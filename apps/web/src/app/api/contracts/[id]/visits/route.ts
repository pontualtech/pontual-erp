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

    const contract = await prisma.contract.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!contract) return error('Contrato não encontrado', 404)

    const visits = await prisma.contractVisit.findMany({
      where: { contract_id: params.id },
      orderBy: { visit_date: 'desc' },
    })

    return success(visits)
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
      include: { customers: true },
    })
    if (!contract) return error('Contrato não encontrado', 404)

    const body = await req.json()

    if (!body.visit_date) return error('Data da visita é obrigatória')

    // Create OS for the visit
    let osId: string | null = null
    if (body.create_os !== false) {
      // Get next OS number
      const lastOs = await prisma.serviceOrder.findFirst({
        where: { company_id: user.companyId },
        orderBy: { os_number: 'desc' },
        select: { os_number: true },
      })
      const nextOsNumber = (lastOs?.os_number || 0) + 1

      // Get default status
      const defaultStatus = await prisma.moduleStatus.findFirst({
        where: { company_id: user.companyId, module: 'os', is_default: true },
      })
      if (!defaultStatus) return error('Configure um status padrão para OS antes de agendar visitas')

      const os = await prisma.serviceOrder.create({
        data: {
          company_id: user.companyId,
          os_number: nextOsNumber,
          customer_id: contract.customer_id,
          status_id: defaultStatus.id,
          priority: 'MEDIUM',
          os_type: 'PREVENTIVA',
          equipment_type: body.equipment_type || 'Manutenção Preventiva',
          reported_issue: body.notes || `Visita preventiva - Contrato ${contract.number || contract.id.slice(0, 8)}`,
          estimated_delivery: new Date(body.visit_date),
        },
      })
      osId = os.id
    }

    const visit = await prisma.contractVisit.create({
      data: {
        company_id: user.companyId,
        contract_id: params.id,
        os_id: osId,
        visit_date: new Date(body.visit_date),
        type: body.type || 'PREVENTIVE',
        status: 'SCHEDULED',
        notes: body.notes || null,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'contratos',
      action: 'schedule_visit',
      entityId: params.id,
      newValue: { visit_id: visit.id, visit_date: body.visit_date, os_id: osId },
    })

    return success({ ...visit, os_id: osId }, 201)
  } catch (err) {
    return handleError(err)
  }
}
