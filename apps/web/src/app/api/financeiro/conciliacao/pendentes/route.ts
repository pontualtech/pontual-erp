import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

// ---------------------------------------------------------------------------
// GET /api/financeiro/conciliacao/pendentes?account_id=xxx
// List unreconciled transactions with suggested matches
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const accountId = searchParams.get('account_id')

    if (!accountId) return error('account_id e obrigatorio', 400)

    // Validate account belongs to company
    const account = await prisma.account.findFirst({
      where: { id: accountId, company_id: user.companyId },
    })
    if (!account) return error('Conta bancaria nao encontrada', 404)

    // Fetch unreconciled transactions
    const transactions = await prisma.transaction.findMany({
      where: {
        company_id: user.companyId,
        account_id: accountId,
        reconciled: false,
      },
      orderBy: { transaction_date: 'desc' },
    })

    // For each transaction, look for suggested matches in payables/receivables
    const DATE_RANGE_DAYS = 5
    const enriched = await Promise.all(
      transactions.map(async (txn) => {
        const txnDate = new Date(txn.transaction_date)
        const dateMin = new Date(txnDate)
        dateMin.setDate(dateMin.getDate() - DATE_RANGE_DAYS)
        const dateMax = new Date(txnDate)
        dateMax.setDate(dateMax.getDate() + DATE_RANGE_DAYS)

        const absAmount = Math.abs(txn.amount)
        let suggestedMatch: {
          type: 'payable' | 'receivable'
          id: string
          description: string
          total_amount: number
          due_date: string
          customer_name: string | null
          status: string | null
        } | null = null

        if (txn.transaction_type === 'DEBIT') {
          // DEBIT transactions match accounts payable
          const payable = await prisma.accountPayable.findFirst({
            where: {
              company_id: user.companyId,
              deleted_at: null,
              status: { in: ['PENDENTE'] },
              total_amount: absAmount,
              due_date: { gte: dateMin, lte: dateMax },
            },
            include: {
              customers: { select: { legal_name: true } },
            },
            orderBy: { due_date: 'asc' },
          })

          if (payable) {
            suggestedMatch = {
              type: 'payable',
              id: payable.id,
              description: payable.description,
              total_amount: payable.total_amount,
              due_date: payable.due_date.toISOString(),
              customer_name: payable.customers?.legal_name || null,
              status: payable.status,
            }
          }
        } else {
          // CREDIT transactions match accounts receivable
          const receivable = await prisma.accountReceivable.findFirst({
            where: {
              company_id: user.companyId,
              deleted_at: null,
              status: { in: ['PENDENTE'] },
              total_amount: absAmount,
              due_date: { gte: dateMin, lte: dateMax },
            },
            include: {
              customers: { select: { legal_name: true } },
            },
            orderBy: { due_date: 'asc' },
          })

          if (receivable) {
            suggestedMatch = {
              type: 'receivable',
              id: receivable.id,
              description: receivable.description,
              total_amount: receivable.total_amount,
              due_date: receivable.due_date.toISOString(),
              customer_name: receivable.customers?.legal_name || null,
              status: receivable.status,
            }
          }
        }

        return {
          ...txn,
          suggested_match: suggestedMatch,
        }
      })
    )

    // Summary counts
    const totalCount = enriched.length
    const withMatch = enriched.filter(t => t.suggested_match).length
    const withoutMatch = totalCount - withMatch

    return success({
      transactions: enriched,
      summary: {
        total: totalCount,
        with_match: withMatch,
        without_match: withoutMatch,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
