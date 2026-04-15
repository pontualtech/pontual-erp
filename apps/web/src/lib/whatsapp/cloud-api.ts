import { prisma } from '@pontual/db'
import { sendWhatsAppEvolution } from './evolution'

/**
 * Send WhatsApp message via Meta Cloud API (official).
 * Uses company-specific settings from DB:
 *   - whatsapp.cloud.phone_number_id
 *   - whatsapp.cloud.access_token
 *
 * Falls back to env vars: META_WHATSAPP_PHONE_ID, META_WHATSAPP_TOKEN
 * If Cloud API is not configured, falls back to Evolution API automatically.
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
    // Fallback to Evolution API
    console.log('[WhatsApp Cloud] Not configured, falling back to Evolution for company', companyId)
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
    // Fallback to Evolution API with plain text (no buttons, but message gets through)
    if (fallbackText) {
      console.log(`[WhatsApp Cloud] Template ${templateName} — falling back to Evolution for company`, companyId)
      const evoResult = await sendWhatsAppEvolution(companyId, phone, fallbackText)
      return { success: evoResult.success, error: evoResult.error }
    }
    // Auto-generate fallback from template params if possible
    const autoFallback = buildFallbackText(templateName, components)
    if (autoFallback) {
      console.log(`[WhatsApp Cloud] Template ${templateName} — auto-fallback to Evolution for company`, companyId)
      const evoResult = await sendWhatsAppEvolution(companyId, phone, autoFallback)
      return { success: evoResult.success, error: evoResult.error }
    }
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
