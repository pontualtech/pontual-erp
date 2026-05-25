/**
 * Wave AE-2C (2026-05-25): dispatcher real do cron payment-reminders-v2.
 *
 * Movido pra lib separada porque o cron route.ts original era 320 linhas;
 * adicionar +200 linhas inline (Wave AE-2B) consistentemente quebrava o
 * build do Coolify (OOM-kill em next build, feedback_next_build_oom).
 * Lib isolada compila independente, reduz pico de memória.
 *
 * Despacha por canal:
 *   - WHATSAPP: sendWhatsAppTemplateMetaOnly + template
 *               payment_overdue_reminder_pt_br (criar via
 *               POST /api/internal/whatsapp/create-payment-overdue-template).
 *               URL do botão = short-link encurtado do magic-link.
 *   - EMAIL: step.template_id se configurado, senão DEFAULT_OVERDUE_EMAIL_HTML.
 *   - SMS: not_implemented (FAILED após 5 attempts, sem spam).
 *
 * Gate em PAYMENT_REMINDERS_V2_REAL_DISPATCH=1. Multi-tenant aberto —
 * template Meta deve existir na WABA da empresa, senão falha graceful
 * (status mantém PENDING, attempts++).
 */

import { prisma } from '@pontual/db'
import { sendWhatsAppTemplateMetaOnly } from '@/lib/whatsapp/cloud-api'
import { sendCompanyEmail } from '@/lib/send-email'
import { buildMagicLink } from '@/lib/portal-magic-url'

export interface DispatchResult {
  ok: boolean
  delivery_meta?: any
  error?: string
}

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

export async function emitReminder(args: {
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS'
  payment_id: string
  rule_step_id: string | null
  company_id: string
  real_dispatch_enabled: boolean
}): Promise<DispatchResult> {
  if (!args.real_dispatch_enabled) {
    return { ok: false, error: 'PAYMENT_REMINDERS_V2_REAL_DISPATCH desabilitado' }
  }

  const ar = await prisma.accountReceivable.findFirst({
    where: { id: args.payment_id, company_id: args.company_id, deleted_at: null },
    include: {
      customers: { select: { id: true, legal_name: true, email: true, mobile: true, custom_data: true } },
      companies: { select: { id: true, name: true, slug: true } },
    },
  })
  if (!ar) return { ok: false, error: 'ar_not_found' }
  if (!ar.due_date) return { ok: false, error: 'ar_no_due_date' }
  if (!ar.customers) return { ok: false, error: 'ar_no_customer' }
  if (ar.status !== 'PENDENTE') return { ok: false, error: `ar_status_${ar.status}` }

  // Wave AE-3 (consistência): opt-out do cliente silencia AE-2 também.
  // Flag única `custom_data.disable_reminders` setada via /portal/[slug]/perfil.
  // Sem isso, cliente que clicou "Desativar lembretes" continuaria recebendo
  // cobrança em atraso — bug funcional do trio AE.
  const cd = (ar.customers.custom_data as Record<string, any> | null) || {}
  if (cd.disable_reminders === true) return { ok: false, error: 'customer_opted_out' }

  const customer = ar.customers
  const company = ar.companies
  const primeiroNome = (customer.legal_name || 'Cliente').split(' ')[0]
  const days = daysOverdue(ar.due_date)
  const arIdShort = ar.id.slice(0, 8)
  const amountBrl = fmtBRL(Number(ar.amount || 0))

  let portalLink = `https://portal.pontualtech.com.br/portal/${company.slug}/pagamento/${ar.id}`
  let shortSlug = ''
  try {
    const ml = buildMagicLink({
      customerId: customer.id,
      companyId: args.company_id,
      slug: company.slug,
    })
    portalLink = ml.url
    try {
      const { shortenUrl } = await import('@/lib/short-link')
      portalLink = await shortenUrl(ml.url, args.company_id, customer.id)
      shortSlug = portalLink.split('/s/').pop() || ''
    } catch (e: any) {
      console.warn(`[AE-2C] shorten falhou AR-${arIdShort}:`, e?.message)
    }
  } catch (e: any) {
    console.warn(`[AE-2C] magic-link falhou AR-${arIdShort}:`, e?.message)
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
