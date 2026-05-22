/**
 * Nurture sender — encapsula envio de email/wa pra steps do playbook.
 *
 * Camada fina sobre sendCompanyEmail + sendWhatsAppTemplateMetaOnly.
 * Faz personalização (primeiro nome, UTM) e retorna resultado uniforme.
 */

import fs from 'fs'
import path from 'path'
import { sendCompanyEmail } from '@/lib/send-email'
import { sendWhatsAppTemplateMetaOnly } from '@/lib/whatsapp/cloud-api'
import type { NurtureStep, NurtureRecurringStep } from './playbook'

const TEMPLATES_DIR = path.join(process.cwd(), 'apps/web/src/lib/nurture/templates')

export interface SendResult {
  ok: boolean
  channel: 'email' | 'wa'
  template: string
  error?: string
  external_id?: string
}

function firstNameFrom(name: string | null | undefined): string {
  if (!name) return ''
  const trimmed = name.trim().split(/\s+/)[0]
  if (!trimmed || trimmed.length < 2) return ''
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
}

function readTemplate(templateName: string): string {
  // Templates podem estar em /lib/nurture/templates ou na raiz do projeto.
  const candidates = [
    path.join(TEMPLATES_DIR, templateName),
    path.join(process.cwd(), templateName),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8')
  }
  throw new Error(`Template não encontrado: ${templateName}`)
}

function personalize(html: string, opts: { firstName: string; campaign: string }): string {
  const utm = `utm_source=email&utm_medium=nurture&utm_campaign=${opts.campaign}`
  const greeting = opts.firstName || 'Olá'
  const greetingAmigo = opts.firstName || 'amigo'

  let out = html
    .replaceAll('{contactfield=firstname|Olá}', greeting)
    .replaceAll('{contactfield=firstname|amigo}', greetingAmigo)
    .replaceAll('{unsubscribe_url}', 'https://pontualtech.com.br/?descadastrar=1')
    .replaceAll('{webview_url}', `https://sosimpressora.com/dicas.html?${utm}`)

  // WhatsApp link com identificador de origem (nurture)
  const waText = `Oi, vim do email da PontualTech: ${opts.campaign}`
  const waUrl = `https://wa.me/5511965760126?text=${encodeURIComponent(waText)}`
  out = out.replace(/href="https:\/\/wa\.me\/[^"]+"/g, `href="${waUrl}"`)

  return out
}

interface SendContext {
  company_id: string
  email: string
  phone: string | null
  name: string | null
  journey_id: string
}

export async function sendEmailStep(
  step: NurtureStep | NurtureRecurringStep,
  ctx: SendContext,
  recurringIteration?: number,
): Promise<SendResult> {
  // Recurring step: rotaciona template/subject por iteração (round-robin)
  let templateFile: string
  let subject: string
  if ('template_pool' in step) {
    const idx = (recurringIteration ?? 0) % step.template_pool.length
    templateFile = step.template_pool[idx]
    subject = step.subject_pool?.[idx] || 'Newsletter PontualTech'
  } else {
    templateFile = step.template
    subject = step.subject || 'Notícia da PontualTech'
  }

  try {
    const html = readTemplate(templateFile)
    const campaign = `nurture_${'template' in step ? 'd' + step.day : 'recurring'}_j${ctx.journey_id.slice(0, 8)}`
    const personalized = personalize(html, {
      firstName: firstNameFrom(ctx.name),
      campaign,
    })

    const ok = await sendCompanyEmail(
      ctx.company_id,
      ctx.email,
      subject,
      personalized,
    )

    return {
      ok,
      channel: 'email',
      template: templateFile,
      error: ok ? undefined : 'send_failed',
    }
  } catch (err) {
    return {
      ok: false,
      channel: 'email',
      template: templateFile,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }
}

export async function sendWaStep(
  step: NurtureStep,
  ctx: SendContext,
): Promise<SendResult> {
  if (!ctx.phone) {
    return { ok: false, channel: 'wa', template: step.template, error: 'no_phone' }
  }

  // Components: {{1}} = primeiro nome (todos os 3 templates usam isso)
  const firstName = firstNameFrom(ctx.name) || 'cliente'
  const components = [
    {
      type: 'body',
      parameters: [{ type: 'text', text: firstName }],
    },
  ]

  try {
    const result = await sendWhatsAppTemplateMetaOnly(
      ctx.company_id,
      ctx.phone,
      step.template,
      'pt_BR',
      components,
      'vendas', // Channel vendas (3136) — campanhas marketing/follow-up vão por aqui
    )
    return {
      ok: result.success === true,
      channel: 'wa',
      template: step.template,
      error: result.success ? undefined : (result.error || 'send_failed'),
      external_id: (result as any).messageId,
    }
  } catch (err) {
    return {
      ok: false,
      channel: 'wa',
      template: step.template,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }
}
