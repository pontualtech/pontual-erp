import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('contratos', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))
    const search = url.get('search') || ''
    const status = url.get('status') || null
    const customerId = url.get('customerId') || null

    const where: any = {
      company_id: user.companyId,
    }

    if (status) where.status = status
    if (customerId) where.customer_id = customerId

    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        include: {
          customers: { select: { id: true, legal_name: true, phone: true, document_number: true } },
          _count: { select: { contract_equipment: true, contract_visits: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contract.count({ where }),
    ])

    return paginated(data, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('contratos', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    if (!body.customer_id) return error('Cliente é obrigatório')
    if (!body.start_date) return error('Data de início é obrigatória')
    if (!body.end_date) return error('Data de término é obrigatória')

    const contract = await prisma.contract.create({
      data: {
        company_id: user.companyId,
        customer_id: body.customer_id,
        number: body.number || null,
        description: body.description || null,
        start_date: new Date(body.start_date),
        end_date: new Date(body.end_date),
        monthly_value: body.monthly_value || 0,
        billing_day: body.billing_day || 1,
        visit_frequency: body.visit_frequency || 'MONTHLY',
        max_visits_per_period: body.max_visits_per_period || null,
        status: body.status || 'ACTIVE',
        auto_renew: body.auto_renew || false,
        renewal_alert_days: body.renewal_alert_days || 30,
        notes: body.notes || null,
      },
      include: {
        customers: { select: { id: true, legal_name: true } },
      },
    })

    // Create equipment if provided
    if (body.equipment && Array.isArray(body.equipment) && body.equipment.length > 0) {
      await prisma.contractEquipment.createMany({
        data: body.equipment.map((eq: any) => ({
          contract_id: contract.id,
          equipment_type: eq.equipment_type || null,
          brand: eq.brand || null,
          model: eq.model || null,
          serial_number: eq.serial_number || null,
          location: eq.location || null,
          next_maintenance: eq.next_maintenance ? new Date(eq.next_maintenance) : null,
        })),
      })
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'contratos',
      action: 'create',
      entityId: contract.id,
      newValue: { number: contract.number, customer: contract.customers.legal_name },
    })

    return success(contract, 201)
  } catch (err) {
    return handleError(err)
  }
}
