import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { updateOSSchema } from '@/lib/validations/os'

type Params = { params: { id: string } }

/** Resolve OS lookup: UUID by id, otherwise by os_number */
function buildOsWhere(id: string, companyId: string) {
  const isUuid = id.includes('-') || id.length > 20
  return isUuid
    ? { id, company_id: companyId, deleted_at: null }
    : { os_number: parseInt(id, 10), company_id: companyId, deleted_at: null }
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: buildOsWhere(params.id, user.companyId) as any,
      include: {
        customers: true,
        user_profiles: { select: { id: true, name: true } },
        service_order_items: { where: { deleted_at: null }, orderBy: { created_at: 'asc' }, take: 100 },
        service_order_photos: { orderBy: { created_at: 'asc' }, take: 50 },
        service_order_history: { orderBy: { created_at: 'desc' }, take: 30 },
        quotes: { orderBy: { created_at: 'desc' } },
        accounts_receivable: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
        },
        invoices: {
          where: { invoice_type: 'NFSE' },
          select: { id: true, invoice_number: true, status: true, danfe_url: true, access_key: true, total_amount: true, created_at: true },
          orderBy: { created_at: 'desc' },
        },
        warranty_original: { select: { id: true, os_number: true } },
      },
    })

    if (!os) return error('OS não encontrada', 404)

    // IDOR protection: motorista can see OS linked to logistics OR in delivery/collection status
    if (user.roleName === 'motorista') {
      const linkedStop = await prisma.logisticsStop.findFirst({
        where: { os_id: os.id, route: { driver_id: user.id } },
      })
      const osStatus = await prisma.moduleStatus.findUnique({ where: { id: os.status_id }, select: { name: true } })
      const isDeliveryStatus = /coleta|coletar|entreg/i.test(osStatus?.name || '')
      if (!linkedStop && !isDeliveryStatus) {
        return error('Acesso negado', 403)
      }
    }

    // Paralelizar queries extras (installments + user names)
    const receivableIds = os.accounts_receivable.map(ar => ar.id)
    const changedByIds = [...new Set(os.service_order_history.map(h => h.changed_by).filter(Boolean))] as string[]

    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

    const [installments, userProfiles, recentOsCount] = await Promise.all([
      receivableIds.length > 0
        ? prisma.installment.findMany({
            where: { parent_type: 'RECEIVABLE', parent_id: { in: receivableIds } },
            orderBy: { installment_number: 'asc' },
          })
        : Promise.resolve([]),
      changedByIds.length > 0
        ? prisma.userProfile.findMany({
            where: { id: { in: changedByIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      os.customer_id
        ? prisma.serviceOrder.count({
            where: {
              customer_id: os.customer_id,
              company_id: user.companyId,
              deleted_at: null,
              created_at: { gte: twelveMonthsAgo },
            },
          })
        : Promise.resolve(0),
    ])

    const installmentsByReceivable = new Map<string, typeof installments>()
    installments.forEach(i => {
      const list = installmentsByReceivable.get(i.parent_id) || []
      list.push(i)
      installmentsByReceivable.set(i.parent_id, list)
    })
    const enrichedReceivables = os.accounts_receivable.map(ar => ({
      ...ar,
      installments: installmentsByReceivable.get(ar.id) || [],
    }))

    const userNameMap: Record<string, string> = Object.fromEntries(userProfiles.map(p => [p.id, p.name]))
    const enrichedHistory = os.service_order_history.map(h => ({
      ...h,
      changed_by_name: h.changed_by ? userNameMap[h.changed_by] || null : null,
    }))

    return success({ ...os, service_order_history: enrichedHistory, accounts_receivable: enrichedReceivables, _recentOsCount: recentOsCount })
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.serviceOrder.findFirst({
      where: buildOsWhere(params.id, user.companyId) as any,
    })
    if (!existing) return error('OS não encontrada', 404)

    // Técnico só pode editar OS atribuídas a ele
    if (user.roleName === 'técnico' && existing.technician_id !== user.id) {
      return error('Você só pode editar OS atribuídas a você', 403)
    }

    const body = await req.json()
    // Validar com Zod strict — rejeita campos não permitidos
    const validated = updateOSSchema.parse(body)

    // Converter strings de data para Date objects para o Prisma
    const data: any = { ...validated }
    if (data.estimated_delivery) data.estimated_delivery = new Date(data.estimated_delivery)
    if (data.actual_delivery) data.actual_delivery = new Date(data.actual_delivery)
    if (data.warranty_until) data.warranty_until = new Date(data.warranty_until)

    const os = await prisma.serviceOrder.update({
      where: { id: existing.id },
      data,
      include: { customers: true },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'update',
      entityId: os.id,
      oldValue: existing as any,
      newValue: validated,
    })

    return success(os)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.serviceOrder.findFirst({
      where: buildOsWhere(params.id, user.companyId) as any,
    })
    if (!existing) return error('OS não encontrada', 404)

    await prisma.serviceOrder.update({
      where: { id: existing.id },
      data: { deleted_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
