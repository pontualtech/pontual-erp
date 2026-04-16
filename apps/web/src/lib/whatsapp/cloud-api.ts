import { prisma } from '@pontual/db'
import { sendWhatsAppEvolution } from './evolution'

/**
 * Send WhatsApp message via Meta Cloud API (official).
 * Uses company-specific settings from DB:
 *   - whatsapp.cloud.phone_number_id
 *   - whatsapp.cloud.access_token
 *
 * Falls back to env vars: META_WHATSAPP_PHONE_ID, META_WHATSAPP_TOKEN
 */

interface CloudSendResult {
  success: boolean
  messageId?: string
  error?: string
}

// Cache per company (TTL 5 min)
const configCache = new Map<string, { data: { phoneNumberId: string; token: string }; expires: number }>()

async function getCloudConfig(companyId: string): Promise<{ phoneNumberId: string; token: string } | null> {
  const cached = configCache.get(companyId)
  if (cached && cached.expires > Date.now()) return cached.data

  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'whatsapp.cloud.' } },
  })

  const get = (key: string) => settings.find(s => s.key === key)?.value || ''

  const phoneNumberId = get('whatsapp.cloud.phone_number_id') || process.env.META_WHATSAPP_PHONE_ID || ''
  const token = get('whatsapp.cloud.access_token') || process.env.META_WHATSAPP_TOKEN || ''

  if (!phoneNumberId || !token) return null

  const data = { phoneNumberId, token }
  configCache.set(companyId, { data, expires: Date.now() + 5 * 60 * 1000 })
  return data
}

/**
 * Send a text message via WhatsApp Cloud API.
 * Note: This only works within the 24h window (customer messaged first)
 * or with approved templates.
 */
export async function sendWhatsAppCloud(
  companyId: string,
  phone: string,
  text: string
): Promise<CloudSendResult> {
  const config = await getCloudConfig(companyId)
  if (!config) {
    // Cloud API not configured — fallback to Evolution API
    console.info('[WhatsApp Cloud] Not configured, falling back to Evolution for company', companyId)
    const evoResult = await sendWhatsAppEvolution(companyId, phone, text)
    return { success: evoResult.success, error: evoResult.error }
  }

  // Format phone: ensure country code, remove non-digits
  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'text',
          text: { body: text },
        }),
        signal: AbortSignal.timeout(10000),
      }
    )

    const data = await res.json()

    if (!res.ok) {
      console.error('[WhatsApp Cloud] Send error:', { status: res.status, error: data.error })
      return { success: false, error: data.error?.message || `HTTP ${res.status}` }
    }

    const messageId = data.messages?.[0]?.id
    return { success: true, messageId }
  } catch (err) {
    console.error('[WhatsApp Cloud] Send failed:', err)
    return { success: false, error: String(err) }
  }
}

/**
 * Send a template message via WhatsApp Cloud API.
 * Templates work outside the 24h window — ideal for notifications.
 */
export async function sendWhatsAppTemplate(
  companyId: string,
  phone: string,
  templateName: string,
  languageCode: string = 'pt_BR',
  components?: any[],
  fallbackText?: string
): Promise<CloudSendResult> {
  const config = await getCloudConfig(companyId)
  if (!config) {
    // Cloud API not configured — fallback to Evolution API with plain text
    const text = fallbackText || buildFallbackText(templateName, components)
    if (text) {
      console.info(`[WhatsApp Cloud] Template ${templateName} — Cloud not configured, falling back to Evolution for company`, companyId)
      const evoResult = await sendWhatsAppEvolution(companyId, phone, text)
      return { success: evoResult.success, error: evoResult.error }
    }
    console.warn(`[WhatsApp Cloud] Template ${templateName} — not configured and no fallback text for company`, companyId)
    return { success: false, error: 'not_configured' }
  }

  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  try {
    const body: any = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    }

    if (components) {
      body.template.components = components
    }

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      }
    )

    const data = await res.json()

    if (!res.ok) {
      console.error('[WhatsApp Cloud Template] Error:', data.error)
      return { success: false, error: data.error?.message || `HTTP ${res.status}` }
    }

    return { success: true, messageId: data.messages?.[0]?.id }
  } catch (err) {
    console.error('[WhatsApp Cloud Template] Failed:', err)
    return { success: false, error: String(err) }
  }
}

// ---------------------------------------------------------------------------
// Interactive Messages — Reply Buttons, List Messages, CTA URL
// ---------------------------------------------------------------------------

export interface ReplyButton {
  id: string    // max 256 chars — payload when clicked
  title: string // max 20 chars — visible text
}

export interface ListRow {
  id: string          // payload when selected
  title: string       // max 24 chars
  description?: string // max 72 chars
}

export interface ListSection {
  title: string   // max 24 chars
  rows: ListRow[]
}

/**
 * Send interactive reply buttons (max 3 buttons).
 * Works within the 24h window only.
 */
export async function sendWhatsAppButtons(
  companyId: string,
  phone: string,
  body: string,
  buttons: ReplyButton[],
  header?: string,
  footer?: string
): Promise<CloudSendResult> {
  const config = await getCloudConfig(companyId)
  if (!config) {
    // Fallback: send as text with numbered options
    const btnText = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n')
    return sendWhatsAppCloud(companyId, phone, `${header ? `*${header}*\n\n` : ''}${body}\n\n${btnText}${footer ? `\n\n_${footer}_` : ''}`)
  }

  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: body },
    action: {
      buttons: buttons.slice(0, 3).map(btn => ({
        type: 'reply',
        reply: { id: btn.id, title: btn.title.slice(0, 20) },
      })),
    },
  }
  if (header) interactive.header = { type: 'text', text: header }
  if (footer) interactive.footer = { text: footer }

  return sendInteractive(config, formattedPhone, interactive)
}

/**
 * Send interactive list message (menu with up to 10 rows).
 * Works within the 24h window only.
 */
export async function sendWhatsAppList(
  companyId: string,
  phone: string,
  body: string,
  buttonText: string,
  sections: ListSection[],
  header?: string,
  footer?: string
): Promise<CloudSendResult> {
  const config = await getCloudConfig(companyId)
  if (!config) {
    // Fallback: send as numbered text list
    const items = sections.flatMap(s => s.rows)
    const listText = items.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ''}`).join('\n')
    return sendWhatsAppCloud(companyId, phone, `${body}\n\n${listText}`)
  }

  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: body },
    action: {
      button: buttonText.slice(0, 20),
      sections: sections.map(s => ({
        title: s.title.slice(0, 24),
        rows: s.rows.map(r => ({
          id: r.id,
          title: r.title.slice(0, 24),
          ...(r.description ? { description: r.description.slice(0, 72) } : {}),
        })),
      })),
    },
  }
  if (header) interactive.header = { type: 'text', text: header }
  if (footer) interactive.footer = { text: footer }

  return sendInteractive(config, formattedPhone, interactive)
}

/**
 * Send CTA URL button (opens a link when clicked).
 * Works within the 24h window only.
 */
export async function sendWhatsAppCtaUrl(
  companyId: string,
  phone: string,
  body: string,
  buttonText: string,
  url: string,
  header?: string,
  footer?: string
): Promise<CloudSendResult> {
  const config = await getCloudConfig(companyId)
  if (!config) {
    // Fallback: send URL in text
    return sendWhatsAppCloud(companyId, phone, `${body}\n\n${url}`)
  }

  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  const interactive: Record<string, unknown> = {
    type: 'cta_url',
    body: { text: body },
    action: {
      name: 'cta_url',
      parameters: {
        display_text: buttonText.slice(0, 20),
        url,
      },
    },
  }
  if (header) interactive.header = { type: 'text', text: header }
  if (footer) interactive.footer = { text: footer }

  return sendInteractive(config, formattedPhone, interactive)
}

/** Low-level: send any interactive message type */
async function sendInteractive(
  config: { phoneNumberId: string; token: string },
  formattedPhone: string,
  interactive: Record<string, unknown>
): Promise<CloudSendResult> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'interactive',
          interactive,
        }),
        signal: AbortSignal.timeout(10000),
      }
    )

    const data = await res.json()

    if (!res.ok) {
      console.error('[WhatsApp Interactive] Error:', data.error)
      return { success: false, error: data.error?.message || `HTTP ${res.status}` }
    }

    return { success: true, messageId: data.messages?.[0]?.id }
  } catch (err) {
    console.error('[WhatsApp Interactive] Failed:', err)
    return { success: false, error: String(err) }
  }
}

/**
 * Build a plain text fallback from known template names + params.
 * Used when Cloud API is not configured (Evolution fallback).
 */
function buildFallbackText(templateName: string, components?: any[]): string | null {
  // Extract body params: [{type:'body', parameters:[{type:'text',text:'val'}]}]
  const bodyComp = components?.find((c: any) => c.type === 'body')
  const params = bodyComp?.parameters?.map((p: any) => p.text) || []

  switch (templateName) {
    case 'pontualtech_status_os':
      // params: os_num, status, equipment
      return `*Atualizacao da sua OS #${params[0] || ''}*\n\nStatus: ${params[1] || ''}\nEquipamento: ${params[2] || ''}\n\nAcompanhe pelo portal do cliente.`

    case 'pontualtech_orcamento':
      // params: os_num, valor, equipment
      return `*Orcamento pronto — OS #${params[0] || ''}*\n\nValor: ${params[1] || ''}\nEquipamento: ${params[2] || ''}\n\nAcesse o portal para aprovar ou recusar o orcamento.`

    case 'pontualtech_pronto':
      // params: os_num, equipment
      return `*Equipamento pronto! — OS #${params[0] || ''}*\n\nSeu ${params[1] || 'equipamento'} esta pronto para retirada!\n\nAcompanhe pelo portal do cliente.`

    case 'pt_coleta_v2':
      // params: os_num
      return `*Coleta agendada — OS #${params[0] || ''}*\n\nSeu agendamento ja esta com nossa logistica.\n\nA coleta ocorrera durante o horario comercial (09:00 as 17:00).\nComo seguimos uma rota, nao ha horario fixo — deixe alguem avisado!\n\nMantenha com voce: cabos de energia e fontes.\nPode enviar: o equipamento com os toners/cartuchos dentro.\n\nAcompanhe pelo portal do cliente.`

    case 'pt_cobranca_v2':
      // params: valor, os_num
      return `*Cobranca — OS #${params[1] || ''}*\n\nValor: ${params[0] || ''}\n\nAcesse o link de pagamento pelo portal do cliente.`

    case 'pt_followup_v2':
      // params: os_num, equipment
      return `Oi! Passando para saber se precisa de algo sobre a OS #${params[0] || ''}${params[1] ? ` (${params[1]})` : ''}.\n\nEstamos a disposicao! Acompanhe pelo portal do cliente.`

    case 'pt_os_aberta_v2':
      // params: os_num, equipment, problema
      return `*OS #${params[0] || ''} aberta!*\n\nEquipamento: ${params[1] || ''}\nProblema: ${params[2] || ''}\n\nAcompanhe pelo portal do cliente.`

    case 'pt_suporte_v1':
      // no params
      return `Estamos transferindo voce para nosso suporte humano. Em breve um atendente vai te ajudar!\n\nAcompanhe pelo portal do cliente.`

    default:
      return null
  }
}
