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
//      attempts<5 e tenta enviar via canal real.
//
// Protegido por CRON_SECRET. Idempotente — pode rodar a cada 5min.
//
// SAFETY GATE (post-audit C1):
//   Real dispatchers (Evolution/SMTP/SMS) ainda não implementados.
//   Sem o gate explícito `PAYMENT_REMINDERS_V2_REAL_DISPATCH=1`, o dispatcher
//   NÃO marca reminders como SENT — fica em PENDING. Isso evita que o ERP
//   diga "cobrança enviada" pro atendente quando na verdade nada saiu.
//   Pra ativar: implementar emitReminder real + setar env=1 no Coolify.

interface DispatchResult {
  ok: boolean
  delivery_meta?: any
  error?: string
}

const REAL_DISPATCH_ENABLED = process.env.PAYMENT_REMINDERS_V2_REAL_DISPATCH === '1'

async function emitReminder(args: {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS'
  payment_id: string
  rule_step_id: string | null
  company_id: string
}): Promise<DispatchResult> {
  if (!REAL_DISPATCH_ENABLED) {
    // Não dispara nada e sinaliza ao caller pra deixar em PENDING.
    // Caller decide o que fazer (não marca SENT, não incrementa attempts).
    return {
      ok: false,
      error: 'PAYMENT_REMINDERS_V2_REAL_DISPATCH desabilitado — dispatchers reais não implementados ainda',
    }
  }
  // TODO: real dispatch hooks vão aqui:
  // - WHATSAPP: chamar Evolution API por tenant (lookup chat_token via Setting)
  // - EMAIL: nodemailer com SMTP por tenant
  // - SMS: provider TBD (twilio? zenvia?)
  return {
    ok: false,
    error: 'Real dispatch ativado mas implementação pendente — não marcar SENT',
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
    let dispatchHeld = 0   // bloqueado pelo safety gate (real dispatch off)
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
    // Safety gate: se real dispatch desabilitado, marca reminders como held.
    // Isso permite ver o que SERIA enviado sem realmente enviar (modo dry-run
    // explícito), e nunca diz "SENT" pra coisa que não saiu.
    if (!REAL_DISPATCH_ENABLED) {
      const heldDue = await prisma.paymentReminder.count({
        where: {
          status: 'PENDING',
          scheduled_for: { lte: new Date() },
          attempts: { lt: 5 },
        },
      })
      dispatchHeld = heldDue

      return success({
        ok: true,
        elapsed_ms: Date.now() - startedAt,
        scheduled: scheduledCount,
        dispatched: 0,
        dispatch_failures: 0,
        dispatch_held: dispatchHeld,
        real_dispatch_enabled: false,
        note: 'PAYMENT_REMINDERS_V2_REAL_DISPATCH=0 — reminders ficam em PENDING até implementação dos dispatchers reais',
        errors,
      })
    }

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
        // Cap em 5 tentativas: na 5ª, marca FAILED (constraint chk_attempts_lt_5
        // será corrigida em fix A1; por enquanto deixa attempts<=4 e FAILED no 5).
        const finalAttempts = Math.min(newAttempts, 4)
        await prisma.paymentReminder.update({
          where: { id: rem.id },
          data: {
            status: newAttempts >= 5 ? 'FAILED' : 'PENDING',
            attempts: finalAttempts,
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
      real_dispatch_enabled: true,
      errors,
    })
  } catch (err) {
    return handleError(err)
  }
}
