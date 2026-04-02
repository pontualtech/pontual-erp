import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const user = await getServerUser()
    if (!user) return error('Não autenticado', 401)

    const q = req.nextUrl.searchParams.get('q')?.trim()
    if (!q || q.length < 2) {
      return success({ os: [], clientes: [], produtos: [] })
    }

    const companyFilter = { company_id: user.companyId, deleted_at: null }
    const isNumeric = /^\d+$/.test(q)

    const [os, clientes, produtos] = await Promise.all([
      // Service Orders
      prisma.serviceOrder.findMany({
        where: {
          ...companyFilter,
          ...(isNumeric
            ? { os_number: parseInt(q, 10) }
            : {
                OR: [
                  { equipment_type: { contains: q, mode: 'insensitive' } },
                  { equipment_brand: { contains: q, mode: 'insensitive' } },
                  { equipment_model: { contains: q, mode: 'insensitive' } },
                  { reported_issue: { contains: q, mode: 'insensitive' } },
                  { diagnosis: { contains: q, mode: 'insensitive' } },
                ],
              }),
        },
        include: {
          module_statuses: { select: { name: true } },
          customers: { select: { legal_name: true } },
        },
        take: 5,
        orderBy: { created_at: 'desc' },
      }),

      // Customers
      prisma.customer.findMany({
        where: {
          ...companyFilter,
          OR: [
            { legal_name: { contains: q, mode: 'insensitive' } },
            { trade_name: { contains: q, mode: 'insensitive' } },
            { document_number: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
            { mobile: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
        orderBy: { created_at: 'desc' },
      }),

      // Products
      prisma.product.findMany({
        where: {
          ...companyFilter,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { internal_code: { contains: q, mode: 'insensitive' } },
            { barcode: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
        orderBy: { created_at: 'desc' },
      }),
    ])

    return success({
      os: os.map((o) => ({
        id: o.id,
        os_number: o.os_number,
        equipment_type: o.equipment_type,
        status_name: o.module_statuses?.name ?? '',
        customer_name: o.customers?.legal_name ?? '',
      })),
      clientes: clientes.map((c) => ({
        id: c.id,
        legal_name: c.legal_name,
        document_number: c.document_number,
        mobile: c.mobile,
      })),
      produtos: produtos.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.internal_code,
        current_stock: p.current_stock,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
