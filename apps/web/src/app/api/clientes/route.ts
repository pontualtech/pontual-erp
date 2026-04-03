import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { createCustomerSchema, normalizeDocument } from '@/lib/validations/clientes'

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
    const city = url.get('city') || null
    const isRecurrent = url.get('isRecurrent') as 'true' | 'false' | null

    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
    }

    // Motorista: only see clients linked to their OS or logistics routes
    const andConditions: any[] = []
    if (user.roleName === 'motorista') {
      // Fetch OS IDs from logistics stops driven by this motorista
      const driverStops = await prisma.logisticsStop.findMany({
        where: {
          company_id: user.companyId,
          route: { driver_id: user.id },
          os_id: { not: null },
        },
        select: { os_id: true },
      })
      const osIdsFromStops = driverStops.map(s => s.os_id!).filter(Boolean)

      andConditions.push({
        OR: [
          // Clients from OS assigned to this motorista (as technician)
          { service_orders: { some: { technician_id: user.id } } },
          // Clients from OS linked to logistics stops on this motorista's routes
          ...(osIdsFromStops.length > 0
            ? [{ service_orders: { some: { id: { in: osIdsFromStops } } } }]
            : []),
        ],
      })
    }

    // Mapear PF/PJ para FISICA/JURIDICA
    if (personType) {
      const personTypeMap: Record<string, string> = { PF: 'FISICA', PJ: 'JURIDICA', FISICA: 'FISICA', JURIDICA: 'JURIDICA' }
      where.person_type = personTypeMap[personType] || personType
    }
    if (customerType) where.customer_type = customerType
    if (city) where.address_city = { equals: city, mode: 'insensitive' }
    // isRecurrent filtering is applied post-query on recent_os_count
    if (search) {
      andConditions.push({
        OR: [
          { legal_name: { contains: search, mode: 'insensitive' } },
          { trade_name: { contains: search, mode: 'insensitive' } },
          { document_number: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      })
    }

    if (andConditions.length > 0) {
      where.AND = andConditions
    }

    const isMotorista = user.roleName === 'motorista'

    const [rawData, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { legal_name: 'asc' },
        include: { _count: { select: { service_orders: true } } },
      }),
      prisma.customer.count({ where }),
    ])

    // Motorista sees limited fields only (strip sensitive data)
    const data = isMotorista
      ? rawData.map(c => ({
          id: c.id, legal_name: c.legal_name, trade_name: c.trade_name,
          phone: c.phone, mobile: c.mobile,
          address_street: c.address_street, address_number: c.address_number,
          address_complement: c.address_complement, address_neighborhood: c.address_neighborhood,
          address_city: c.address_city, address_state: c.address_state, address_zip: c.address_zip,
          created_at: c.created_at, _count: c._count,
        }))
      : rawData

    // Calculate recent OS count (last 12 months) for recurrence badge
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)

    const customerIds = data.map(c => c.id)
    const recentOsCounts = customerIds.length > 0
      ? await prisma.serviceOrder.groupBy({
          by: ['customer_id'],
          where: {
            customer_id: { in: customerIds },
            created_at: { gte: twelveMonthsAgo },
          },
          _count: { id: true },
        })
      : []
    const recentOsMap = Object.fromEntries(
      recentOsCounts.map(r => [r.customer_id, r._count.id])
    )

    let enriched = data.map((c: any) => ({
      ...c,
      os_count: c._count?.service_orders ?? c.total_os ?? 0,
      recent_os_count: recentOsMap[c.id] ?? 0,
      _count: undefined,
    }))

    // Apply recurrence filter post-query (based on recent_os_count >= 3)
    if (isRecurrent === 'true') {
      enriched = enriched.filter((c: any) => c.recent_os_count >= 3)
    } else if (isRecurrent === 'false') {
      enriched = enriched.filter((c: any) => c.recent_os_count < 3)
    }

    // When recurrence filter is active, adjust total for pagination
    const finalTotal = isRecurrent ? enriched.length : total

    return paginated(enriched, finalTotal, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('clientes', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const rawBody = await req.json()
    const parseResult = createCustomerSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return error(`Dados inválidos: ${parseResult.error.errors.map(e => e.message).join(', ')}`, 400)
    }
    const body = { ...parseResult.data, _update: rawBody._update }

    // Check for duplicates by document, mobile, or email
    const dupConditions: any[] = []
    const docDigits = body.document_number || ''
    const mobileDigits = (body.mobile || '').replace(/\D/g, '')
    const phoneDigits = (body.phone || '').replace(/\D/g, '')
    const email = (body.email || '').trim().toLowerCase()

    if (docDigits.length >= 11) dupConditions.push({ document_number: docDigits })
    if (mobileDigits.length >= 10) dupConditions.push({ mobile: { contains: mobileDigits.slice(-10) } })
    if (phoneDigits.length >= 10) dupConditions.push({ phone: { contains: phoneDigits.slice(-10) } })
    if (email) dupConditions.push({ email: { equals: email, mode: 'insensitive' as const } })

    if (dupConditions.length > 0) {
      // CPF/CNPJ is the primary key — check it first with exact match
      let existing = null
      if (docDigits.length >= 11) {
        existing = await prisma.customer.findFirst({
          where: { company_id: user.companyId, deleted_at: null, document_number: docDigits },
        })
      }
      // Fallback: check by mobile, phone, email
      if (!existing) {
        existing = await prisma.customer.findFirst({
          where: { company_id: user.companyId, deleted_at: null, OR: dupConditions },
        })
      }

      if (existing) {
        // If body has _update=true, update the existing record instead
        if (body._update) {
          const updated = await prisma.customer.update({
            where: { id: existing.id },
            data: {
              legal_name: body.legal_name || existing.legal_name,
              trade_name: body.trade_name ?? existing.trade_name,
              person_type: body.person_type || existing.person_type,
              customer_type: body.customer_type || existing.customer_type,
              document_number: docDigits || existing.document_number,
              email: body.email || existing.email,
              phone: body.phone || existing.phone,
              mobile: body.mobile || existing.mobile,
              address_street: body.address_street || existing.address_street,
              address_number: body.address_number || existing.address_number,
              address_complement: body.address_complement ?? existing.address_complement,
              address_neighborhood: body.address_neighborhood || existing.address_neighborhood,
              address_city: body.address_city || existing.address_city,
              address_state: body.address_state || existing.address_state,
              address_zip: body.address_zip || existing.address_zip,
              notes: body.notes ?? existing.notes,
            },
          })
          return success({ ...updated, _was_updated: true })
        }

        // Return existing customer with duplicate flag so frontend can offer to update
        const reasons: string[] = []
        if (docDigits && existing.document_number === docDigits) reasons.push('CPF/CNPJ')
        if (mobileDigits && existing.mobile?.includes(mobileDigits.slice(-10))) reasons.push('celular')
        if (phoneDigits && existing.phone?.includes(phoneDigits.slice(-10))) reasons.push('telefone')
        if (email && existing.email?.toLowerCase() === email) reasons.push('email')

        return NextResponse.json({
          error: `Cliente já cadastrado por ${reasons.join(', ')}`,
          existing: existing,
          match_fields: reasons,
        }, { status: 409 })
      }
    }

    const customer = await prisma.customer.create({
      data: {
        company_id: user.companyId,
        legal_name: body.legal_name,
        trade_name: body.trade_name,
        person_type: body.person_type || 'FISICA',
        customer_type: body.customer_type || 'CLIENTE',
        document_number: docDigits || body.document_number,
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
