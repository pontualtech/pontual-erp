import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { findMatchesBatch } from '@/lib/acquirer/match-engine'
import { performMatch } from '@/lib/acquirer/perform-match'

/**
 * POST /api/financeiro/maquininha/match-auto
 *
 * Roda match automatico em todas as transacoes pendentes da empresa
 * (ou subset via body). Auto-vincula apenas as com score >= 95 E
 * gap >= 10 pontos pro 2o lugar (evita ambiguidade).
 *
 * Body opcional: { transaction_ids: string[] }
 *
 * Resposta:
 *   {
 *     processed, auto_linked, suggestions, skipped, errors,
 *     details: [{ transaction_id, action, os_number, score, reason }]
 *   }
 *
 * Permission: financeiro.edit
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const txnIds: string[] | undefined = Array.isArray(body.transaction_ids) ? body.transaction_ids : undefined

    const matches = await findMatchesBatch(user.companyId, txnIds)

    let autoLinked = 0
    let suggestions = 0
    let skipped = 0
    let errors = 0
    const details: any[] = []

    for (const m of matches) {
      if (!m.best) {
        skipped++
        details.push({ transaction_id: m.transaction_id, action: 'no_match', reason: m.reason_skip || 'sem candidatas com score >= 80' })
        continue
      }
      if (!m.auto_link) {
        suggestions++
        details.push({
          transaction_id: m.transaction_id,
          action: 'suggestion',
          os_number: m.best.os_number,
          score: m.best.score,
          reason: 'score < 95 ou gap < 10 — revisar manualmente',
        })
        continue
      }

      // Auto-vincula
      const r = await performMatch({
        transactionId: m.transaction_id,
        serviceOrderId: m.best.os_id,
        companyId: user.companyId,
        matchMethod: 'AUTO',
        matchConfidence: m.best.score,
      })
      if (r.ok) {
        autoLinked++
        details.push({
          transaction_id: m.transaction_id,
          action: 'auto_linked',
          os_number: r.os_number,
          score: m.best.score,
        })
      } else {
        errors++
        details.push({ transaction_id: m.transaction_id, action: 'error', reason: r.error })
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'acquirer_match_auto',
      newValue: { processed: matches.length, autoLinked, suggestions, skipped, errors },
    })

    return success({
      processed: matches.length,
      auto_linked: autoLinked,
      suggestions,
      skipped,
      errors,
      details: details.slice(0, 100),
    })
  } catch (err) {
    return handleError(err)
  }
}
