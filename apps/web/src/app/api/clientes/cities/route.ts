import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('clientes', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cities = await prisma.customer.findMany({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        address_city: { not: null },
      },
      select: { address_city: true },
      distinct: ['address_city'],
      orderBy: { address_city: 'asc' },
    })

    const data = cities
      .map(c => c.address_city)
      .filter((c): c is string => Boolean(c))

    return success(data)
  } catch (err) {
    return handleError(err)
  }
}
