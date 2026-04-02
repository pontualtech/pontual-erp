import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { paginated, handleError } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const type = searchParams.get('type') // NFE, NFCE, NFSE
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const customerId = searchParams.get('customerId')

    const where: any = { company_id: user.companyId }
    if (type) where.invoice_type = type
    if (status) where.status = status
    if (customerId) where.customer_id = customerId
    if (startDate || endDate) {
      where.issued_at = {}
      if (startDate) where.issued_at.gte = new Date(startDate)
      if (endDate) where.issued_at.lte = new Date(endDate)
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customers: { select: { id: true, legal_name: true, document_number: true } },
          _count: { select: { invoice_items: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ])

    return paginated(invoices, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}
