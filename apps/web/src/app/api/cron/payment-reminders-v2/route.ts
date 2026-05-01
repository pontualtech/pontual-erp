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

        // A4 fix (audit): pre-load TODOS os reminders existentes desta empresa
        // em UMA query, em vez de findFirst per (ar × step). Antes:
        //   O(companies × rules × steps × ars) findFirst queries — 3.000 pra
        //   3 empresas × 2 rules × 5 steps × 100 ARs.
        // Agora: 1 findMany por empresa. Existência checada via Set local.
        const existingReminders = await prisma.paymentReminder.findMany({
          where: { company_id: companyId },
          select: { payment_id: true, rule_step_id: true },
        })
        const existingKey = (paymentId: string, ruleStepId: string | null) =>
          `${paymentId}::${ruleStepId ?? ''}`
        const existingSet = new Set<string>(
          existingReminders.map(r => existingKey(r.payment_id, r.rule_step_id))
        )

        // A3 fix (audit): batch dos reminders novos em createMany com
        // skipDuplicates pra eliminar race condition entre 2 invocações
        // simultâneas do cron. Em vez de findFirst+create separados (TOCTOU),
        // colecta os candidatos e cria em um único batch atomico no fim.
        const toCreate: Array<{
          company_id: string
          payment_id: string
          rule_step_id: string
          scheduled_for: Date
          channel: 'WHATSAPP' | 'EMAIL' | 'SMS'
        }> = []

        for (const rule of rules) {
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
              if (scheduled.getTime() > today.getTime()) continue

              const paymentId = ar.id
              const k = existingKey(paymentId, step.id)
              if (existingSet.has(k)) continue
              // Local set evita duplicates dentro deste batch
              existingSet.add(k)

              toCreate.push({
                company_id: companyId,
                payment_id: paymentId,
                rule_step_id: step.id,
                scheduled_for: scheduled,
                channel: step.channel as 'WHATSAPP' | 'EMAIL' | 'SMS',
              })
            }
          }
        }

        if (toCreate.length > 0) {
          // skipDuplicates protege contra race entre 2 cron jobs concorrentes.
          // Idealmente a tabela teria UNIQUE(company_id, payment_id, rule_step_id)
          // — pendente em fase futura via ensure script.
          const created = await prisma.paymentReminder.createMany({
            data: toCreate,
            skipDuplicates: true,
          })
          scheduledCount += created.count
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

    // M8 fix (audit): tenant fairness via round-robin. Antes, take:100
    // global ordenado por scheduled_for permitia que UM tenant com 100+
    // reminders vencidos monopolizasse todo o batch — outros tenants não
    // recebiam dispatch nessa execução.
    // Agora: pega max 20 reminders vencidos por tenant, depois entrelaça
    // por round-robin pra equalizar atenção. Soma global ainda <= 200,
    // protege capacity dos providers (Evolution/SMTP).
    const PER_TENANT_LIMIT = 20
    const GLOBAL_LIMIT = 200
    const dueByTenant = await prisma.paymentReminder.groupBy({
      by: ['company_id'],
      where: {
        status: 'PENDING',
        scheduled_for: { lte: new Date() },
        attempts: { lt: 5 },
      },
      _count: true,
    })

    type ReminderRow = Awaited<ReturnType<typeof prisma.paymentReminder.findMany>>[number]
    const tenantBatches: ReminderRow[][] = []
    for (const t of dueByTenant) {
      const batch = await prisma.paymentReminder.findMany({
        where: {
          company_id: t.company_id,
          status: 'PENDING',
          scheduled_for: { lte: new Date() },
          attempts: { lt: 5 },
        },
        take: PER_TENANT_LIMIT,
        orderBy: { scheduled_for: 'asc' },
      })
      tenantBatches.push(batch)
    }
    // Entrelaça: pick 1 de cada tenant, depois pick 2, ...
    const due: ReminderRow[] = []
    let idx = 0
    while (due.length < GLOBAL_LIMIT) {
      let picked = false
      for (const batch of tenantBatches) {
        if (idx < batch.length && due.length < GLOBAL_LIMIT) {
          due.push(batch[idx])
          picked = true
        }
      }
      if (!picked) break
      idx++
    }

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
        // A1 fix aplicado: constraint agora aceita attempts BETWEEN 0 AND 5.
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
      real_dispatch_enabled: true,
      errors,
    })
  } catch (err) {
    return handleError(err)
  }
}
