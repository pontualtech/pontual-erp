import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(_request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    const base: any = { company_id: user.companyId }

    const [
      totalNfe,
      totalNfse,
      authorizedMonth,
      rejectedMonth,
      processingCount,
      monthlyRevenue,
      monthlyTax,
    ] = await Promise.all([
      prisma.invoice.count({ where: { ...base, invoice_type: 'NFE' } }),
      prisma.invoice.count({ where: { ...base, invoice_type: 'NFSE' } }),

      prisma.invoice.count({
        where: {
          ...base,
          status: 'AUTHORIZED',
          OR: [
            { authorized_at: { gte: startOfMonth, lte: endOfMonth } },
            { authorized_at: null, issued_at: { gte: startOfMonth, lte: endOfMonth } },
            { authorized_at: null, issued_at: null, created_at: { gte: startOfMonth, lte: endOfMonth } },
          ],
        },
      }),

      prisma.invoice.count({
        where: { ...base, status: 'REJECTED', created_at: { gte: startOfMonth, lte: endOfMonth } },
      }),

      prisma.invoice.count({
        where: { ...base, status: 'PROCESSING' },
      }),

      prisma.invoice.aggregate({
        where: {
          ...base,
          status: 'AUTHORIZED',
          OR: [
            { authorized_at: { gte: startOfMonth, lte: endOfMonth } },
            { authorized_at: null, issued_at: { gte: startOfMonth, lte: endOfMonth } },
            { authorized_at: null, issued_at: null, created_at: { gte: startOfMonth, lte: endOfMonth } },
          ],
        },
        _sum: { total_amount: true },
      }),

      prisma.invoice.aggregate({
        where: {
          ...base,
          status: 'AUTHORIZED',
          OR: [
            { authorized_at: { gte: startOfMonth, lte: endOfMonth } },
            { authorized_at: null, issued_at: { gte: startOfMonth, lte: endOfMonth } },
            { authorized_at: null, issued_at: null, created_at: { gte: startOfMonth, lte: endOfMonth } },
          ],
        },
        _sum: { tax_amount: true },
      }),
    ])

    // Last 6 months breakdown
    const monthlyBreakdown: { month: string; nfe: number; nfse: number; totalCents: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59)
      const mWhere: any = {
        ...base,
        status: 'AUTHORIZED',
        OR: [
          { authorized_at: { gte: mStart, lte: mEnd } },
          { authorized_at: null, issued_at: { gte: mStart, lte: mEnd } },
          { authorized_at: null, issued_at: null, created_at: { gte: mStart, lte: mEnd } },
        ],
      }

      const [nfeCount, nfseCount, mTotal] = await Promise.all([
        prisma.invoice.count({ where: { ...mWhere, invoice_type: 'NFE' } }),
        prisma.invoice.count({ where: { ...mWhere, invoice_type: 'NFSE' } }),
        prisma.invoice.aggregate({ where: mWhere, _sum: { total_amount: true } }),
      ])

      monthlyBreakdown.push({
        month: mStart.toISOString().slice(0, 7),
        nfe: nfeCount,
        nfse: nfseCount,
        totalCents: mTotal._sum.total_amount ?? 0,
      })
    }

    return success({
      totalNfe,
      totalNfse,
      currentMonth: {
        authorized: authorizedMonth,
        rejected: rejectedMonth,
        processing: processingCount,
        revenueCents: monthlyRevenue._sum.total_amount ?? 0,
        taxCents: monthlyTax._sum.tax_amount ?? 0,
      },
      monthlyBreakdown,
    })
  } catch (err) {
    return handleError(err)
  }
}
