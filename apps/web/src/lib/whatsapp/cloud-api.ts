import { prisma } from '@pontual/db'

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
    console.warn('[WhatsApp Cloud] Not configured for company', companyId)
    return { success: false, error: 'not_configured' }
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
  components?: any[]
): Promise<CloudSendResult> {
  const config = await getCloudConfig(companyId)
  if (!config) {
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
