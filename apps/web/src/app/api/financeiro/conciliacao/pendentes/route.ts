import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

// ---------------------------------------------------------------------------
// GET /api/financeiro/conciliacao/pendentes?account_id=xxx
// List unreconciled transactions with suggested matches
// Optimized: fetches all payables/receivables in bulk, matches in memory
// ---------------------------------------------------------------------------

const DATE_RANGE_DAYS = 15
const AMOUNT_TOLERANCE = 0.02 // 2%

interface MatchCandidate {
  type: 'payable' | 'receivable'
  id: string
  description: string
  total_amount: number
  due_date: string
  customer_name: string | null
  status: string | null
}

interface SuggestedMatch extends MatchCandidate {
  match_confidence: 'exact' | 'close'
  amount_diff_pct: number
  name_match: boolean
}

/**
 * Normalize text for fuzzy comparison: lowercase, remove accents, trim
 */
function normalize(str: string | null | undefined): string {
  if (!str) return ''
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

/**
 * Check if any word from the memo appears in the candidate description or customer name
 */
function hasNameMatch(memo: string | null, description: string, customerName: string | null): boolean {
  const memoNorm = normalize(memo)
  if (!memoNorm || memoNorm.length < 3) return false

  const memoWords = memoNorm.split(/\s+/).filter(w => w.length >= 3)
  if (memoWords.length === 0) return false

  const target = normalize(description) + ' ' + normalize(customerName)

  return memoWords.some(word => target.includes(word))
}

/**
 * Find best match for a transaction from a list of candidates
 */
function findBestMatch(
  txnAmount: number,
  txnDate: Date,
  txnMemo: string | null,
  candidates: MatchCandidate[],
): SuggestedMatch | null {
  let bestMatch: SuggestedMatch | null = null
  let bestScore = -1

  for (const candidate of candidates) {
    const candidateDate = new Date(candidate.due_date)

    // Date filter: within +-15 days
    const daysDiff = Math.abs(
      (txnDate.getTime() - candidateDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (daysDiff > DATE_RANGE_DAYS) continue

    // Amount filter: within +-2%
    const amountDiffPct = Math.abs(txnAmount - candidate.total_amount) / Math.max(txnAmount, candidate.total_amount, 1)
    if (amountDiffPct > AMOUNT_TOLERANCE) continue

    const isExact = txnAmount === candidate.total_amount
    const nameMatch = hasNameMatch(txnMemo, candidate.description, candidate.customer_name)

    // Score: exact amount > close amount, name match bonus, closer date is better
    let score = 0
    if (isExact) score += 100
    else score += 50 // close match still worth something
    if (nameMatch) score += 30
    score += Math.max(0, DATE_RANGE_DAYS - daysDiff) // closer date = higher score

    if (score > bestScore) {
      bestScore = score
      bestMatch = {
        ...candidate,
        match_confidence: isExact ? 'exact' : 'close',
        amount_diff_pct: Math.round(amountDiffPct * 10000) / 100, // e.g. 1.5 = 1.5%
        name_match: nameMatch,
      }
    }
  }

  return bestMatch
}

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

    if (transactions.length === 0) {
      return success({
        transactions: [],
        summary: { total: 0, with_match: 0, without_match: 0, exact_match: 0, close_match: 0 },
      })
    }

    // Compute global date range from all transactions (±15 days from min/max)
    const txnDates = transactions.map(t => new Date(t.transaction_date).getTime())
    const globalMin = new Date(Math.min(...txnDates))
    globalMin.setDate(globalMin.getDate() - DATE_RANGE_DAYS)
    const globalMax = new Date(Math.max(...txnDates))
    globalMax.setDate(globalMax.getDate() + DATE_RANGE_DAYS)

    // Fetch ALL pending payables and receivables in ONE query each (fix N+1)
    const [payables, receivables] = await Promise.all([
      prisma.accountPayable.findMany({
        where: {
          company_id: user.companyId,
          deleted_at: null,
          status: { in: ['PENDENTE'] },
          due_date: { gte: globalMin, lte: globalMax },
        },
        include: {
          customers: { select: { legal_name: true } },
        },
      }),
      prisma.accountReceivable.findMany({
        where: {
          company_id: user.companyId,
          deleted_at: null,
          status: { in: ['PENDENTE'] },
          due_date: { gte: globalMin, lte: globalMax },
        },
        include: {
          customers: { select: { legal_name: true } },
        },
      }),
    ])

    // Build candidate lists
    const payableCandidates: MatchCandidate[] = payables.map(p => ({
      type: 'payable' as const,
      id: p.id,
      description: p.description,
      total_amount: p.total_amount,
      due_date: p.due_date.toISOString(),
      customer_name: p.customers?.legal_name || null,
      status: p.status,
    }))

    const receivableCandidates: MatchCandidate[] = receivables.map(r => ({
      type: 'receivable' as const,
      id: r.id,
      description: r.description,
      total_amount: r.total_amount,
      due_date: r.due_date.toISOString(),
      customer_name: r.customers?.legal_name || null,
      status: r.status,
    }))

    // Track which records have been matched to avoid double-matching
    const usedIds = new Set<string>()

    // Match in memory
    const enriched = transactions.map(txn => {
      const txnDate = new Date(txn.transaction_date)
      const absAmount = Math.abs(txn.amount)

      const candidates = txn.transaction_type === 'DEBIT' ? payableCandidates : receivableCandidates
      const availableCandidates = candidates.filter(c => !usedIds.has(c.id))

      const match = findBestMatch(absAmount, txnDate, txn.description, availableCandidates)

      if (match) {
        usedIds.add(match.id)
      }

      return {
        ...txn,
        suggested_match: match,
      }
    })

    // Summary counts
    const totalCount = enriched.length
    const withMatch = enriched.filter(t => t.suggested_match).length
    const exactMatch = enriched.filter(t => t.suggested_match?.match_confidence === 'exact').length
    const closeMatch = enriched.filter(t => t.suggested_match?.match_confidence === 'close').length
    const withoutMatch = totalCount - withMatch

    return success({
      transactions: enriched,
      summary: {
        total: totalCount,
        with_match: withMatch,
        without_match: withoutMatch,
        exact_match: exactMatch,
        close_match: closeMatch,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
