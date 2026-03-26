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
    const status = url.get('status') || null
    const serviceOrderId = url.get('serviceOrderId') || null

    const where: any = { company_id: user.companyId }
    if (status) where.status = status
    if (serviceOrderId) where.service_order_id = serviceOrderId

    const [data, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          service_orders: {
            select: { id: true, os_number: true, equipment_type: true },
          },
          quote_items: true,
        },
      }),
      prisma.quote.count({ where }),
    ])

    return paginated(data, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const { serviceOrderId, validUntil, notes } = await req.json()

    if (!serviceOrderId) return error('serviceOrderId é obrigatório', 400)

    const os = await prisma.serviceOrder.findFirst({
      where: { id: serviceOrderId, company_id: user.companyId, deleted_at: null },
      include: { service_order_items: { where: { deleted_at: null } } },
    })
    if (!os) return error('OS não encontrada', 404)

    // Auto-increment quote number
    const lastQuote = await prisma.quote.findFirst({
      where: { company_id: user.companyId },
      orderBy: { quote_number: 'desc' },
      select: { quote_number: true },
    })

    const totalAmount = os.service_order_items.reduce((s, i) => s + i.total_price, 0)

    // Copy OS items into quote items
    const quote = await prisma.quote.create({
      data: {
        company_id: user.companyId,
        service_order_id: serviceOrderId,
        quote_number: (lastQuote?.quote_number || 0) + 1,
        status: 'DRAFT',
        total_amount: totalAmount,
        valid_until: validUntil ? new Date(validUntil) : null,
        notes: notes || null,
        quote_items: {
          create: os.service_order_items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.total_price,
          })),
        },
      },
      include: { quote_items: true },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'create_quote',
      entityId: serviceOrderId,
      newValue: { quoteId: quote.id, quoteNumber: quote.quote_number },
    })

    return success(quote, 201)
  } catch (err) {
    return handleError(err)
  }
}
