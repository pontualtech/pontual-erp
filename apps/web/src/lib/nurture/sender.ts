/**
 * Nurture sender — encapsula envio de email/wa pra steps do playbook.
 *
 * Camada fina sobre sendCompanyEmail + sendWhatsAppTemplateMetaOnly.
 * Faz personalização (primeiro nome, UTM) e retorna resultado uniforme.
 */

import fs from 'fs'
import path from 'path'
import { prisma } from '@pontual/db'
import { sendCompanyEmail } from '@/lib/send-email'
import { sendWhatsAppTemplateMetaOnly } from '@/lib/whatsapp/cloud-api'
import type { NurtureStep, NurtureRecurringStep } from './playbook'

// Path resolution robusto pra Next standalone (path.join(process.cwd(), 'apps/...')
// não funciona porque cwd é /app dentro do container e os arquivos ficam em
// .next/standalone/apps/web/src/lib/nurture/templates). Tenta vários candidates.
const TEMPLATES_CANDIDATES = [
  // Standalone bundle (Docker): __dirname já aponta pra dentro do bundle
  path.join(__dirname, 'templates'),
  // Dev: process.cwd() = apps/web
  path.join(process.cwd(), 'src/lib/nurture/templates'),
  // Dev monorepo: process.cwd() = repo root
  path.join(process.cwd(), 'apps/web/src/lib/nurture/templates'),
]

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
  for (const dir of TEMPLATES_CANDIDATES) {
    const p = path.join(dir, templateName)
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8')
  }
  throw new Error(`Template nao encontrado em nenhum candidate: ${templateName} (tried: ${TEMPLATES_CANDIDATES.join(', ')})`)
}

// Defaults usados quando o tenant não tem Setting nurture.* configurada.
// Pontualtech-001 herda esses defaults — Imprimitech (e futuros) devem
// setar os seus próprios via Setting{key=nurture.unsubscribe_url, etc}.
// 2026-05-29 (CRIT-1 fix): URL aponta pro endpoint RFC 8058 direto (não
// pra página estática descadastrar.html, que dropava query string no redirect).
const DEFAULT_UNSUBSCRIBE_URL = 'https://erp.pontualtech.work/api/public/unsubscribe'
const DEFAULT_WEBVIEW_URL = 'https://sosimpressora.com/dicas.html'
const DEFAULT_WA_NUMBER = '551131360415' // PT vendas (voz + whats)

interface TenantNurtureConfig {
  unsubscribeUrl: string
  webviewUrl: string
  waNumber: string
}

const configCache = new Map<string, { config: TenantNurtureConfig; expires: number }>()
const CACHE_TTL = 5 * 60 * 1000

async function getTenantNurtureConfig(companyId: string): Promise<TenantNurtureConfig> {
  const cached = configCache.get(companyId)
  if (cached && cached.expires > Date.now()) return cached.config

  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'nurture.' } },
    select: { key: true, value: true },
  })
  const get = (k: string) => settings.find(s => s.key === k)?.value || ''

  const config: TenantNurtureConfig = {
    unsubscribeUrl: get('nurture.unsubscribe_url') || DEFAULT_UNSUBSCRIBE_URL,
    webviewUrl: get('nurture.webview_url') || DEFAULT_WEBVIEW_URL,
    waNumber: get('nurture.wa_number') || DEFAULT_WA_NUMBER,
  }
  configCache.set(companyId, { config, expires: Date.now() + CACHE_TTL })
  return config
}

function buildUnsubUrl(baseUrl: string, recipientEmail: string): string {
  const sep = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${sep}email=${encodeURIComponent(recipientEmail)}`
}

async function personalize(
  html: string,
  opts: { firstName: string; campaign: string; companyId: string; recipientEmail: string }
): Promise<string> {
  const tenant = await getTenantNurtureConfig(opts.companyId)
  const utm = `utm_source=email&utm_medium=nurture&utm_campaign=${opts.campaign}`
  const greeting = opts.firstName || 'Olá'
  const greetingAmigo = opts.firstName || 'amigo'
  const webviewSep = tenant.webviewUrl.includes('?') ? '&' : '?'
  // CRIT-1 fix 2026-05-29: link unsub carrega ?email= pro endpoint
  // marcar diretamente (RFC 8058 + UX one-click sem redigitar).
  const unsubUrlForLink = buildUnsubUrl(tenant.unsubscribeUrl, opts.recipientEmail)

  let out = html
    .replaceAll('{contactfield=firstname|Olá}', greeting)
    .replaceAll('{contactfield=firstname|amigo}', greetingAmigo)
    .replaceAll('{unsubscribe_url}', unsubUrlForLink)
    .replaceAll('{webview_url}', `${tenant.webviewUrl}${webviewSep}${utm}`)

  // WhatsApp link com identificador de origem (nurture) + número do tenant
  const waText = `Oi, vim do email: ${opts.campaign}`
  const waUrl = `https://wa.me/${tenant.waNumber}?text=${encodeURIComponent(waText)}`
  out = out.replace(/href="https:\/\/wa\.me\/[^"]+"/g, `href="${waUrl}"`)

  return out
}

// Adiciona Prisma import — necessário pro getTenantNurtureConfig query Settings.

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
    const personalized = await personalize(html, {
      firstName: firstNameFrom(ctx.name),
      campaign,
      companyId: ctx.company_id,
      recipientEmail: ctx.email,
    })

    // CRIT-1 fix: ativa header List-Unsubscribe pro one-click nativo
    // Gmail/Outlook/Yahoo. Mesma URL do link visual (consistência).
    const tenantForHeader = await getTenantNurtureConfig(ctx.company_id)
    const unsubscribeUrl = buildUnsubUrl(tenantForHeader.unsubscribeUrl, ctx.email)

    const ok = await sendCompanyEmail(
      ctx.company_id,
      ctx.email,
      subject,
      personalized,
      undefined,
      { unsubscribeUrl },
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
