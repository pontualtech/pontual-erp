import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendWhatsAppTemplateMetaOnly } from '@/lib/whatsapp/cloud-api'
import { sendCompanyEmail } from '@/lib/send-email'
import { buildMagicLink } from '@/lib/portal-magic-url'

// Next 14: route depende de cookies/headers/searchParams — força runtime
export const dynamic = 'force-dynamic'

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

/**
 * Wave AE-2 (2026-05-24): default HTML pra cobrança em atraso quando o step
 * não tem template_id configurado. Simples, sem assets externos, vars básicas.
 */
const DEFAULT_OVERDUE_EMAIL_HTML = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
    <tr><td style="background:#dc2626;padding:24px;text-align:center;color:#fff;">
      <h1 style="margin:0;font-size:20px;">Fatura em atraso</h1>
      <p style="margin:6px 0 0;font-size:13px;opacity:0.9;">{{company_name}}</p>
    </td></tr>
    <tr><td style="padding:28px 24px;">
      <p style="margin:0 0 14px;font-size:15px;color:#0f172a;">Olá <strong>{{customer_name}}</strong>,</p>
      <p style="margin:0 0 14px;font-size:14px;color:#334155;line-height:1.6;">
        Identificamos que a sua fatura <strong>#{{ar_id_short}}</strong> no valor de
        <strong>{{amount}}</strong> venceu há <strong>{{days_overdue}} dias</strong>.
      </p>
      <p style="margin:0 0 22px;font-size:14px;color:#334155;line-height:1.6;">
        Você pode regularizar diretamente pelo seu Portal a qualquer momento.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="background:#dc2626;border-radius:10px;">
          <a href="{{portal_link}}" style="display:inline-block;color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 32px;">
            Regularizar Agora
          </a>
        </td>
      </tr></table>
      <p style="margin:22px 0 0;font-size:11px;color:#94a3b8;text-align:center;">
        Esta é uma mensagem automática. Em caso de dúvida, responda diretamente este email.
      </p>
    </td></tr>
  </table>
</body></html>`

function replaceVars(html: string, vars: Record<string, string>): string {
  let out = html
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v || '—')
  }
  return out
}

function daysOverdue(due: Date): number {
  const now = new Date()
  now.setUTCHours(0, 0, 0, 0)
  const d = new Date(due)
  d.setUTCHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)))
}

function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/**
 * Wave AE-2 (2026-05-24): dispatcher real pra payment-reminders-v2.
 *
 * Antes era stub (TODO). Agora despacha por canal:
 *   - WHATSAPP: sendWhatsAppTemplateMetaOnly + template payment_overdue_reminder_pt_br
 *               (criar via POST /api/internal/whatsapp/create-payment-overdue-template).
 *               URL do botão = short-link encurtado do magic-link do portal.
 *   - EMAIL: step.template_id se configurado, senão DEFAULT_OVERDUE_EMAIL_HTML.
 *            Vars: customer_name, company_name, ar_id_short, amount, days_overdue, portal_link.
 *   - SMS: not_implemented (FAILED após 5 attempts, sem spam).
 *
 * Gate continua em PAYMENT_REMINDERS_V2_REAL_DISPATCH=1. Multi-tenant
 * aberto — template Meta deve existir na WABA da empresa, senão falha
 * graceful e mantém PENDING.
 */
async function emitReminder(args: {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS'
  payment_id: string
  rule_step_id: string | null
  company_id: string
}): Promise<DispatchResult> {
  if (!REAL_DISPATCH_ENABLED) {
    return {
      ok: false,
      error: 'PAYMENT_REMINDERS_V2_REAL_DISPATCH desabilitado',
    }
  }

  // Busca AR + customer + company numa query só
  const ar = await prisma.accountReceivable.findFirst({
    where: { id: args.payment_id, company_id: args.company_id, deleted_at: null },
    include: {
      customers: { select: { id: true, legal_name: true, email: true, mobile: true } },
      companies: { select: { id: true, name: true, slug: true } },
    },
  })
  if (!ar) return { ok: false, error: 'ar_not_found' }
  if (!ar.due_date) return { ok: false, error: 'ar_no_due_date' }
  if (!ar.customers) return { ok: false, error: 'ar_no_customer' }
  if (ar.status !== 'PENDENTE') return { ok: false, error: `ar_status_${ar.status}` }

  const customer = ar.customers
  const company = ar.companies
  const primeiroNome = (customer.legal_name || 'Cliente').split(' ')[0]
  const days = daysOverdue(ar.due_date)
  const arIdShort = ar.id.slice(0, 8)
  const amountBrl = fmtBRL(Number(ar.amount || 0))

  // Magic link → /portal/{slug}/pagamento/{ar.id}
  let portalLink = `https://portal.pontualtech.com.br/portal/${company.slug}/pagamento/${ar.id}`
  let shortSlug = ''
  try {
    const ml = buildMagicLink({
      customerId: customer.id,
      companyId: args.company_id,
      slug: company.slug,
      // OS opcional aqui — magic-link cai no portal home (cliente navega até pagamento)
    })
    portalLink = ml.url
    try {
      const { shortenUrl } = await import('@/lib/short-link')
      portalLink = await shortenUrl(ml.url, args.company_id, customer.id)
      shortSlug = portalLink.split('/s/').pop() || ''
    } catch (e: any) {
      console.warn(`[AE-2] shorten falhou AR-${arIdShort}:`, e?.message)
    }
  } catch (e: any) {
    console.warn(`[AE-2] magic-link falhou AR-${arIdShort}:`, e?.message)
  }

  if (args.channel === 'WHATSAPP') {
    if (!customer.mobile) return { ok: false, error: 'customer_no_mobile' }
    if (!shortSlug) return { ok: false, error: 'shortlink_required_for_whatsapp_template' }
    const result = await sendWhatsAppTemplateMetaOnly(
      args.company_id,
      customer.mobile,
      'payment_overdue_reminder_pt_br',
      'pt_BR',
      [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: primeiroNome },
            { type: 'text', text: arIdShort },
            { type: 'text', text: String(days) },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: shortSlug }],
        },
      ],
      'suporte',
    )
    return {
      ok: result.success,
      delivery_meta: result.success ? { message_id: result.messageId } : undefined,
      error: result.success ? undefined : result.error,
    }
  }

  if (args.channel === 'EMAIL') {
    if (!customer.email) return { ok: false, error: 'customer_no_email' }
    // Step.template_id se configurado — busca em messageTemplate
    let html = DEFAULT_OVERDUE_EMAIL_HTML
    if (args.rule_step_id) {
      const step = await prisma.cobrancaRuleStep.findUnique({
        where: { id: args.rule_step_id },
        select: { template_id: true },
      })
      if (step?.template_id) {
        const tpl = await prisma.messageTemplate.findFirst({
          where: { id: step.template_id, company_id: args.company_id, is_active: true },
        })
        if (tpl?.template) html = tpl.template
      }
    }
    const vars = {
      customer_name: customer.legal_name || 'Cliente',
      company_name: company.name || 'Empresa',
      ar_id_short: arIdShort,
      amount: amountBrl,
      days_overdue: String(days),
      portal_link: portalLink,
    }
    const subject = `Fatura em atraso #${arIdShort} — ${company.name}`
    try {
      const sent = await sendCompanyEmail(args.company_id, customer.email, subject, replaceVars(html, vars))
      return {
        ok: !!sent,
        delivery_meta: { to: customer.email, subject },
        error: sent ? undefined : 'email_send_returned_false',
      }
    } catch (e: any) {
      return { ok: false, error: `email_exception: ${e?.message}` }
    }
  }

  if (args.channel === 'SMS') {
    return { ok: false, error: 'sms_not_implemented' }
  }

  return { ok: false, error: `unknown_channel: ${args.channel}` }
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

    // N5 fix (audit pos-fix): advisory lock pra evitar 2+ réplicas rodando
    // scheduler/dispatcher em paralelo. Try-acquire imediato; se outro nó
    // já tem o lock, skip silent (próxima rodada do cron tenta de novo).
    // Lock liberado no COMMIT da tx interna — auto-release.
    const tryLock = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT pg_try_advisory_lock(hashtext('cron:payment-reminders-v2')::bigint) AS ok
    `
    if (!tryLock[0]?.ok) {
      return success({
        ok: true,
        skipped: true,
        reason: 'concurrent_run — outro nó executando',
        elapsed_ms: Date.now() - startedAt,
      })
    }

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

      const earlyResult = success({
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
      await prisma.$executeRaw`SELECT pg_advisory_unlock(hashtext('cron:payment-reminders-v2')::bigint)`.catch(() => {})
      return earlyResult
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

    const finalResult = success({
      ok: true,
      elapsed_ms: Date.now() - startedAt,
      scheduled: scheduledCount,
      dispatched: dispatchedCount,
      dispatch_failures: dispatchFailures,
      real_dispatch_enabled: true,
      errors,
    })
    // N5: libera lock advisory (session-scoped — não é tx)
    await prisma.$executeRaw`SELECT pg_advisory_unlock(hashtext('cron:payment-reminders-v2')::bigint)`.catch(() => {})
    return finalResult
  } catch (err) {
    // N5: libera lock no catch também
    await prisma.$executeRaw`SELECT pg_advisory_unlock(hashtext('cron:payment-reminders-v2')::bigint)`.catch(() => {})
    return handleError(err)
  }
}
