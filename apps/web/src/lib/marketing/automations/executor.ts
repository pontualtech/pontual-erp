/**
 * Marketing Stage Automations — executor.
 *
 * Chamado pelo PATCH /api/marketing/contatos/[id]/stage após mudar a fase.
 * Não-bloqueante: enfileira em background, não atrasa a resposta HTTP.
 *
 * Fluxo:
 * 1. Encontra automations matching (from_stage/to_stage com null=wildcard)
 * 2. Pra cada uma, cria MarketingAutomationRun com status='pending'
 * 3. Executa imediatamente (delay_minutes=0) ou agenda (delay_minutes>0)
 *    — MVP: só implementa delay=0; >0 marca como skipped com nota
 * 4. Executor por action_type:
 *    - email: Resend API (mesmo padrão do campanhas/send)
 *    - whatsapp/webhook/task: STUB (loga, marca skipped — implementar depois)
 *
 * Tratamento de erro: cada run isolado em try/catch. Falha de uma automation
 * não bloqueia outras nem retorna erro pro client.
 */

import { prisma } from '@pontual/db'

interface FireOptions {
  companyId: string
  contactId: string
  fromStage: string | null
  toStage: string | null
}

interface ContactSnapshot {
  email: string
  name: string | null
  phone: string | null
}

export async function fireStageAutomations(opts: FireOptions): Promise<void> {
  // Lista automations ativas matching from/to (NULL = wildcard)
  const automations = await prisma.marketingStageAutomation.findMany({
    where: {
      company_id: opts.companyId,
      active: true,
      AND: [
        { OR: [{ from_stage: null }, { from_stage: opts.fromStage }] },
        { OR: [{ to_stage: null }, { to_stage: opts.toStage }] },
      ],
    },
  })

  if (automations.length === 0) return

  // Carrega snapshot do contato — necessário pra substituir vars no template
  const contact = await prisma.marketingContact.findFirst({
    where: { id: opts.contactId, company_id: opts.companyId },
    select: { email: true, name: true, phone: true },
  })
  if (!contact) return

  // Dispara cada automation isolada — fire-and-forget
  for (const automation of automations) {
    runOneAutomation(automation, contact, opts).catch(err => {
      console.error('[automation] uncaught error:', automation.id, err)
    })
  }
}

async function runOneAutomation(
  automation: any,
  contact: ContactSnapshot,
  opts: FireOptions,
) {
  const run = await prisma.marketingAutomationRun.create({
    data: {
      company_id: opts.companyId,
      automation_id: automation.id,
      contact_id: opts.contactId,
      from_stage: opts.fromStage,
      to_stage: opts.toStage,
      status: 'running',
    },
  })

  try {
    // MVP: delay > 0 = não executa agora (futuro: jobs queue)
    if (automation.delay_minutes > 0) {
      await prisma.marketingAutomationRun.update({
        where: { id: run.id },
        data: { status: 'skipped', error: `delay_minutes=${automation.delay_minutes} — drip queue não implementada`, finished_at: new Date() },
      })
      return
    }

    let result: any = null
    switch (automation.action_type) {
      case 'email':
        result = await executeEmail(automation.payload, contact, opts.companyId)
        break
      case 'whatsapp':
        result = { stub: true, message: 'WhatsApp não implementado no MVP' }
        await prisma.marketingAutomationRun.update({
          where: { id: run.id },
          data: { status: 'skipped', result: result as any, finished_at: new Date() },
        })
        return
      case 'webhook':
        result = await executeWebhook(automation.payload, contact, opts)
        break
      case 'task':
        result = { stub: true, message: 'Task não implementado no MVP' }
        await prisma.marketingAutomationRun.update({
          where: { id: run.id },
          data: { status: 'skipped', result: result as any, finished_at: new Date() },
        })
        return
      default:
        throw new Error(`action_type desconhecido: ${automation.action_type}`)
    }

    await prisma.marketingAutomationRun.update({
      where: { id: run.id },
      data: { status: 'success', result: result as any, finished_at: new Date() },
    })
  } catch (e: any) {
    await prisma.marketingAutomationRun.update({
      where: { id: run.id },
      data: { status: 'failed', error: e?.message?.slice(0, 500) || 'unknown', finished_at: new Date() },
    })
  }
}

/** Envia email via Resend. Reusa config do tenant (email.resend_api_key, from). */
async function executeEmail(
  payload: any,
  contact: ContactSnapshot,
  companyId: string,
): Promise<any> {
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'email.' } },
  })
  const get = (k: string) => settings.find(s => s.key === k)?.value || ''
  const apiKey = get('email.resend_api_key') || process.env.RESEND_API_KEY || ''
  const fromName = get('email.from_name') || 'Marketing'
  const fromAddress = get('email.from_address') || ''

  if (!apiKey) throw new Error('RESEND_API_KEY não configurada no tenant nem global')
  if (!fromAddress) throw new Error('email.from_address não configurada')

  const firstName = pickFirstName(contact.name)
  const html = (payload.html as string)
    .replaceAll('{{nome}}', firstName)
    .replaceAll('{{email}}', contact.email)
  const subject = (payload.subject as string).replaceAll('{{nome}}', firstName)

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName} <${fromAddress}>`,
      to: [contact.email],
      subject,
      html,
      tags: [
        { name: 'campaign', value: payload.campaignTag },
        { name: 'company', value: companyId },
        { name: 'source', value: 'automation' },
      ],
    }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok || !body?.id) {
    throw new Error(body?.message || `HTTP ${r.status}`)
  }
  return { resend_id: body.id, to: contact.email }
}

/** Dispara webhook com payload renderizado. Timeout 5s. */
async function executeWebhook(
  payload: any,
  contact: ContactSnapshot,
  opts: FireOptions,
): Promise<any> {
  const body = renderTemplate(payload.bodyTemplate || '', contact, opts)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const r = await fetch(payload.url, {
      method: payload.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(payload.headers || {}),
      },
      body: body || JSON.stringify({ contact, fromStage: opts.fromStage, toStage: opts.toStage }),
      signal: controller.signal,
    })
    const text = await r.text().catch(() => '')
    if (!r.ok) throw new Error(`HTTP ${r.status} ${text.slice(0, 100)}`)
    return { status: r.status, response: text.slice(0, 500) }
  } finally {
    clearTimeout(timeout)
  }
}

function renderTemplate(tpl: string, contact: ContactSnapshot, opts: FireOptions): string {
  if (!tpl) return ''
  return tpl
    .replaceAll('{{email}}', contact.email)
    .replaceAll('{{nome}}', contact.name || '')
    .replaceAll('{{telefone}}', contact.phone || '')
    .replaceAll('{{from_stage}}', opts.fromStage || '')
    .replaceAll('{{to_stage}}', opts.toStage || '')
}

function pickFirstName(full: string | null): string {
  if (!full) return 'amigo'
  const trimmed = full.trim()
  if (/\b(LTDA|S\/A|S\.A|ME|EIRELI|EPP)\b/i.test(trimmed)) return 'amigo'
  const first = trimmed.split(/\s+/)[0]
  if (!first || first.length < 2) return 'amigo'
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}
