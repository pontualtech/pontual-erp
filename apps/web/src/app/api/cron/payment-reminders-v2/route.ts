import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'

// GET /api/cron/payment-reminders-v2
// Worker da régua de cobrança v2:
//   1. SCHEDULER: scaneia AR PENDENTE em todas as empresas; pra cada
//      cobranca_rule ativa + cada step, cria PaymentReminder (idempotente)
//      quando due_date + trigger_days_offset <= hoje.
//   2. DISPATCHER: pega PaymentReminders PENDING + scheduled_for<=NOW() +
//      attempts<5; "envia" via canal (stub registra delivery_meta hoje;
//      real dispatch pluggable via emitReminder()).
//
// Protegido por CRON_SECRET. Idempotente — pode rodar a cada 5min.

interface DispatchResult {
  ok: boolean
  delivery_meta?: any
  error?: string
}

async function emitReminder(args: {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS'
  payment_id: string
  rule_step_id: string | null
  company_id: string
}): Promise<DispatchResult> {
  // STUB: real dispatch hooks vão aqui.
  // - WHATSAPP: chamar Evolution API por tenant (lookup chat_token via Setting)
  // - EMAIL: nodemailer com SMTP por tenant
  // - SMS: provider TBD (twilio? zenvia?)
  // Por enquanto loga e retorna ok=true pra validar flow end-to-end.
  return {
    ok: true,
    delivery_meta: {
      stub: true,
      ts: new Date().toISOString(),
      channel: args.channel,
      note: 'Real dispatcher não implementado — flow validado em modo stub',
    },
  }
}

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return error('CRON_SECRET não configurado', 503)

    const authHeader = request.headers.get('authorization') ?? ''
    const expected = `Bearer ${cronSecret}`
    if (
      authHeader.length !== expected.length ||
      !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
    ) {
      return error('Não autorizado', 401)
    }

    const startedAt = Date.now()
    let scheduledCount = 0
    let dispatchedCount = 0
    let dispatchFailures = 0
    const errors: string[] = []

    // ─── Phase 1: Scheduler ────────────────────────────────────────────────
    // Pra cada empresa ativa com pelo menos 1 régua ativa:
    const companiesWithRules = await prisma.cobrancaRule.groupBy({
      by: ['company_id'],
      where: { is_active: true },
    })

    for (const c of companiesWithRules) {
      const companyId = c.company_id
      try {
        const rules = await prisma.cobrancaRule.findMany({
          where: { company_id: companyId, is_active: true },
          include: { steps: { orderBy: { step_order: 'asc' } } },
        })

        const ars = await prisma.accountReceivable.findMany({
          where: {
            company_id: companyId,
            status: 'PENDENTE',
            deleted_at: null,
          },
          select: { id: true, due_date: true },
        })

        for (const rule of rules) {
          // applies_to_segment: hoje só ALL ou null aplicam globalmente.
          // Outros segmentos (CUSTOMER_TAG:premium, AMOUNT_GT:100000) requerem
          // matcher mais elaborado — TODO futuro.
          if (rule.applies_to_segment && rule.applies_to_segment !== 'ALL') {
            continue
          }

          for (const step of rule.steps) {
            for (const ar of ars) {
              if (!ar.due_date) continue
              const scheduled = new Date(ar.due_date)
              scheduled.setUTCDate(scheduled.getUTCDate() + step.trigger_days_offset)

              const today = new Date()
              today.setUTCHours(23, 59, 59, 999)
              if (scheduled.getTime() > today.getTime()) continue // ainda não chegou a hora

              // M-013 dual-write: AR.id == payments.id (origin_type=ACCOUNT_RECEIVABLE)
              const paymentId = ar.id

              const exists = await prisma.paymentReminder.findFirst({
                where: {
                  company_id: companyId,
                  payment_id: paymentId,
                  rule_step_id: step.id,
                },
                select: { id: true },
              })
              if (exists) continue

              await prisma.paymentReminder.create({
                data: {
                  company_id: companyId,
                  payment_id: paymentId,
                  rule_step_id: step.id,
                  scheduled_for: scheduled,
                  channel: step.channel,
                  status: 'PENDING',
                },
              })
              scheduledCount++
            }
          }
        }
      } catch (e: any) {
        errors.push(`scheduler company=${companyId}: ${e.message}`)
      }
    }

    // ─── Phase 2: Dispatcher ───────────────────────────────────────────────
    const due = await prisma.paymentReminder.findMany({
      where: {
        status: 'PENDING',
        scheduled_for: { lte: new Date() },
        attempts: { lt: 5 },
      },
      take: 100, // batch limit por execução
      orderBy: { scheduled_for: 'asc' },
    })

    for (const rem of due) {
      const result = await emitReminder({
        channel: rem.channel,
        payment_id: rem.payment_id,
        rule_step_id: rem.rule_step_id,
        company_id: rem.company_id,
      })

      if (result.ok) {
        await prisma.paymentReminder.update({
          where: { id: rem.id },
          data: {
            status: 'SENT',
            sent_at: new Date(),
            attempts: rem.attempts + 1,
            delivery_meta: result.delivery_meta ?? {},
          },
        })
        dispatchedCount++
      } else {
        dispatchFailures++
        const newAttempts = rem.attempts + 1
        await prisma.paymentReminder.update({
          where: { id: rem.id },
          data: {
            status: newAttempts >= 5 ? 'FAILED' : 'PENDING',
            attempts: newAttempts,
            error_message: result.error?.slice(0, 500) ?? 'unknown',
          },
        })
      }
    }

    return success({
      ok: true,
      elapsed_ms: Date.now() - startedAt,
      scheduled: scheduledCount,
      dispatched: dispatchedCount,
      dispatch_failures: dispatchFailures,
      errors,
    })
  } catch (err) {
    return handleError(err)
  }
}
