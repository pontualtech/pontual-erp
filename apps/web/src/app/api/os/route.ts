import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))
    const search = url.get('search') || ''
    const statusIds = url.getAll('statusId').filter(Boolean)
    const technicianId = url.get('assignedTo') || url.get('technicianId') || null
    const priority = url.get('priority') || null
    const osType = url.get('osType') || null

    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
    }

    // Data-level RBAC: filter OS by role unless showAll=true
    const showAll = url.get('showAll') === 'true'
    const ownOnly = url.get('own_only') === 'true'

    if (ownOnly) {
      where.technician_id = user.id
    } else if (!showAll) {
      const role = user.roleName // e.g. 'técnico', 'motorista', 'admin', 'atendente', 'financeiro'
      if (role === 'técnico') {
        where.technician_id = user.id
      } else if (role === 'motorista') {
        // Motorista only sees OS in delivery/collection-related statuses
        const deliveryStatuses = await prisma.moduleStatus.findMany({
          where: {
            company_id: user.companyId,
            module: 'os',
            OR: [
              { name: { contains: 'coletar', mode: 'insensitive' } },
              { name: { contains: 'entregar', mode: 'insensitive' } },
              { name: { contains: 'coleta', mode: 'insensitive' } },
              { name: { contains: 'entrega', mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        })
        if (deliveryStatuses.length > 0) {
          where.status_id = { in: deliveryStatuses.map(s => s.id) }
        }
      }
      // admin, atendente, financeiro -> no filter (see all)
    }

    const overdue = url.get('overdue') === 'true'

    // Apply explicit status filter — intersect with role-based filter if present
    if (statusIds.length > 0) {
      const roleStatusFilter = where.status_id // may be set by motorista role filter
      if (roleStatusFilter?.in && Array.isArray(roleStatusFilter.in)) {
        // Intersect: only keep statusIds that are also in the role-allowed set
        const allowedSet = new Set(roleStatusFilter.in as string[])
        const intersected = statusIds.filter(id => allowedSet.has(id))
        where.status_id = intersected.length === 1 ? intersected[0] : { in: intersected }
      } else {
        if (statusIds.length === 1) where.status_id = statusIds[0]
        else where.status_id = { in: statusIds }
      }
    }

    const filterOsType = url.get('osType')
    if (filterOsType) where.os_type = filterOsType
    const filterOsLocation = url.get('osLocation')
    if (filterOsLocation) where.os_location = filterOsLocation
    const filterEquipType = url.get('equipmentType')
    if (filterEquipType) where.equipment_type = filterEquipType

    // Ocultar canceladas por padrão (status is_final = true)
    // Quando um statusId específico é fornecido, ignorar hideCancelled (evita conflito)
    const hideCancelled = url.get('hideCancelled') === 'true'
    if (hideCancelled && statusIds.length === 0) {
      const finalStatuses = await prisma.moduleStatus.findMany({
        where: { company_id: user.companyId, module: 'os', is_final: true },
        select: { id: true },
      })
      if (finalStatuses.length > 0) {
        where.status_id = { ...where.status_id, notIn: finalStatuses.map(s => s.id) }
      }
    }

    const dateFrom = url.get('dateFrom')
    const dateTo = url.get('dateTo')
    if (dateFrom || dateTo) {
      where.created_at = {}
      if (dateFrom) where.created_at.gte = new Date(dateFrom + 'T00:00:00.000Z')
      if (dateTo) where.created_at.lte = new Date(dateTo + 'T23:59:59.999Z')
    }
    if (technicianId) where.technician_id = technicianId
    if (priority) where.priority = priority
    if (osType) where.os_type = osType

    // Filtro de OS em atraso: tem data de previsão e passou, e não está em status final
    if (overdue) {
      where.estimated_delivery = { lt: new Date() }
      where.actual_delivery = null
    }
    if (search) {
      where.OR = [
        { os_number: !isNaN(Number(search)) && Number(search) > 0 ? Number(search) : undefined },
        { equipment_type: { contains: search, mode: 'insensitive' } },
        { reported_issue: { contains: search, mode: 'insensitive' } },
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
      ].filter(Boolean)
    }

    const [data, total] = await Promise.all([
      prisma.serviceOrder.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customers: { select: { id: true, legal_name: true, phone: true, document_number: true } },
          module_statuses: { select: { id: true, name: true, color: true } },
          user_profiles: { select: { id: true, name: true } },
          accounts_receivable: {
            where: { deleted_at: null },
            select: { id: true, status: true, total_amount: true, received_amount: true },
            take: 1,
            orderBy: { created_at: 'desc' },
          },
          invoices: {
            where: { invoice_type: 'NFSE', status: 'AUTHORIZED' },
            select: { id: true, invoice_number: true, danfe_url: true, access_key: true },
            take: 1,
          },
        },
      }),
      prisma.serviceOrder.count({ where }),
    ])

    return paginated(data, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    // Validate customer_id exists
    const customerId = body.customer_id || body.customerId
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, company_id: user.companyId, deleted_at: null },
      })
      if (!customer) {
        return error('Cliente não encontrado. Verifique o ID informado.', 400)
      }
    }

    // Get initial status for this company
    const initialStatus = await prisma.moduleStatus.findFirst({
      where: { company_id: user.companyId, module: 'os', is_default: true },
    })
    if (!initialStatus) return error('Status inicial não configurado para OS', 500)

    // Criar OS com número atômico (prevenir race condition)
    const os = await prisma.$transaction(async (tx) => {
      // Advisory lock por company_id para evitar race condition na numeração
      // pg_advisory_xact_lock é liberado automaticamente ao fim da transação
      const lockKey = Buffer.from(user.companyId).reduce((acc, b) => acc + b, 0)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      const result = await tx.$queryRaw<{ next_number: number }[]>`
        SELECT COALESCE(MAX(os_number), 0) + 1 as next_number
        FROM service_orders
        WHERE company_id = ${user.companyId}
      `
      const nextNumber = result[0]?.next_number || 1

      const created = await tx.serviceOrder.create({
        data: {
          company_id: user.companyId,
          os_number: nextNumber,
          customer_id: body.customer_id || body.customerId,
          status_id: initialStatus.id,
          technician_id: body.technician_id || body.technicianId,
          priority: body.priority || 'MEDIUM',
          os_type: body.os_type || body.osType || 'AVULSO',
          os_location: body.os_location || body.osLocation || null,
          equipment_type: body.equipment_type || body.equipmentType || body.equipment,
          equipment_brand: body.equipment_brand || body.equipmentBrand,
          equipment_model: body.equipment_model || body.equipmentModel,
          serial_number: body.serial_number || body.serialNumber,
          reported_issue: body.reported_issue || body.reportedIssue,
          reception_notes: body.reception_notes || body.receptionNotes,
          internal_notes: body.internal_notes || body.internalNotes || undefined,
          estimated_cost: body.estimated_cost || body.estimatedCost,
          estimated_delivery: body.estimated_delivery || body.estimatedDelivery ? new Date(body.estimated_delivery || body.estimatedDelivery) : undefined,
        },
        include: { customers: true },
      })

      // Log initial status in history dentro da mesma transação
      await tx.serviceOrderHistory.create({
        data: {
          company_id: user.companyId,
          service_order_id: created.id,
          to_status_id: initialStatus.id,
          changed_by: user.id,
          notes: 'OS criada',
        },
      })

      return created
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'create',
      entityId: os.id,
      newValue: body,
    })

    return success(os, 201)
  } catch (err) {
    return handleError(err)
  }
}
