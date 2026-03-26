import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('clientes', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const page = Math.max(1, Number(url.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(url.get('limit') || '20')))
    const search = url.get('search') || ''
    const personType = url.get('personType') as 'PF' | 'PJ' | null
    const customerType = url.get('customerType') || null

    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
    }

    if (personType) where.person_type = personType
    if (customerType) where.customer_type = customerType
    if (search) {
      where.OR = [
        { legal_name: { contains: search, mode: 'insensitive' } },
        { trade_name: { contains: search, mode: 'insensitive' } },
        { document_number: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ]
    }

    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { legal_name: 'asc' },
      }),
      prisma.customer.count({ where }),
    ])

    return paginated(data, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('clientes', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    const customer = await prisma.customer.create({
      data: {
        company_id: user.companyId,
        legal_name: body.legal_name,
        trade_name: body.trade_name,
        person_type: body.person_type || 'FISICA',
        customer_type: body.customer_type || 'CLIENTE',
        document_number: body.document_number,
        email: body.email,
        phone: body.phone,
        mobile: body.mobile,
        address_street: body.address_street,
        address_number: body.address_number,
        address_complement: body.address_complement,
        address_neighborhood: body.address_neighborhood,
        address_city: body.address_city,
        address_state: body.address_state,
        address_zip: body.address_zip,
        state_registration: body.state_registration,
        city_registration: body.city_registration,
        notes: body.notes,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'clientes',
      action: 'create',
      entityId: customer.id,
      newValue: body,
    })

    return success(customer, 201)
  } catch (err) {
    return handleError(err)
  }
}
