import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, handleError } from '@/lib/api-response'
import { requireInternalKey } from '@/lib/internal-auth'
import {
  getActiveJourneys, evaluateNextStep, recordStepSent, endJourney,
  detectReactivations,
} from '@/lib/nurture/journey'
import { sendEmailStep, sendWaStep } from '@/lib/nurture/sender'

// Next 14: depende de headers — força runtime
export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/cron/nurture-tick
 *
 * Roda 1×/dia (via Coolify scheduled task). 2 etapas:
 *   1. detectReactivations: para cada journey ativa, checa se cliente já voltou
 *      e abriu OS — se sim, fecha journey com outcome='reactivated'.
 *   2. processSteps: para cada journey ativa restante, avalia próximo step
 *      e dispara email/wa.
 *
 * Idempotente via advisory lock pra evitar concorrência (multi-réplica).
 *
 * Auth: x-internal-key
 *
 * Query params (opcionais, pra debug):
 *   ?dry_run=1  — não envia, só reporta o que faria
 *   ?company_id=<uuid> — limita a 1 tenant
 */
export async function POST(req: NextRequest) {
  const guard = requireInternalKey(req)
  if (guard) return guard

  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get('dry_run') === '1'
  const companyFilter = searchParams.get('company_id') || undefined

  // Advisory lock
  const lock = await prisma.$queryRaw<Array<{ ok: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext('cron:nurture-tick')::bigint) AS ok
  `
  if (!lock[0]?.ok) {
    return success({ skipped: true, reason: 'concurrent_run' })
  }

  try {
    const stats = {
      dry_run: dryRun,
      reactivations: 0,
      journeys_evaluated: 0,
      steps_sent_email: 0,
      steps_sent_wa: 0,
      steps_skipped_unsubscribed: 0,
      steps_skipped_bounced: 0,
      steps_skipped_no_phone: 0,
      failed: 0,
      details: [] as any[],
    }

    // 1. Detecta reativações primeiro (fechar journeys antes de processar)
    const reactivations = await detectReactivations()
    for (const r of reactivations) {
      if (!dryRun) await endJourney(r.journey_id, 'reactivated')
      stats.reactivations++
      stats.details.push({ kind: 'reactivated', journey_id: r.journey_id, os_id: r.os_id })
    }

    // 2. Processa steps das journeys ativas restantes
    const active = await getActiveJourneys(companyFilter)
    for (const j of active) {
      stats.journeys_evaluated++

      // Skip se contato unsubscribed ou bounce alto (>3)
      if (j.contact.unsubscribed) {
        stats.steps_skipped_unsubscribed++
        continue
      }
      if (j.contact.bounce_count >= 3) {
        stats.steps_skipped_bounced++
        if (!dryRun) await endJourney(j.id, 'bounced')
        continue
      }

      const evalRes = evaluateNextStep(j)
      if (!evalRes) continue

      const { step, isRecurring, recurringIteration } = evalRes
      const ctx = {
        company_id: j.company_id,
        email: j.contact.email,
        phone: j.contact.phone,
        name: j.contact.name,
        journey_id: j.id,
      }

      if (step.channel === 'email') {
        if (dryRun) {
          stats.steps_sent_email++
          stats.details.push({ kind: 'would_send_email', journey_id: j.id, step: (step as any).day ?? 'recurring', iteration: recurringIteration })
          continue
        }
        const r = await sendEmailStep(step as any, ctx, recurringIteration)
        if (r.ok) {
          stats.steps_sent_email++
          await recordStepSent(j.id)
        } else {
          stats.failed++
          stats.details.push({ kind: 'failed_email', journey_id: j.id, error: r.error })
        }
      } else if (step.channel === 'wa') {
        if (!ctx.phone) {
          stats.steps_skipped_no_phone++
          continue
        }
        if (dryRun) {
          stats.steps_sent_wa++
          stats.details.push({ kind: 'would_send_wa', journey_id: j.id, step: (step as any).day, template: (step as any).template })
          continue
        }
        const r = await sendWaStep(step as any, ctx)
        if (r.ok) {
          stats.steps_sent_wa++
          await recordStepSent(j.id)
        } else {
          stats.failed++
          stats.details.push({ kind: 'failed_wa', journey_id: j.id, error: r.error })
        }
      }
    }

    return success(stats)
  } catch (err) {
    return handleError(err, {
      url: '/api/internal/cron/nurture-tick',
      method: 'POST',
    })
  } finally {
    await prisma.$executeRaw`SELECT pg_advisory_unlock(hashtext('cron:nurture-tick')::bigint)`.catch(() => {})
  }
}
