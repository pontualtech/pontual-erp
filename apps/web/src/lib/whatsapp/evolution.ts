import { prisma } from '@pontual/db'

/**
 * Send WhatsApp message via Evolution API.
 * Supports multi-tenant: loads config from DB per company,
 * falls back to env vars for backward compatibility.
 *
 * DB Settings keys:
 *   - whatsapp.evolution.api_url
 *   - whatsapp.evolution.api_key
 *   - whatsapp.evolution.instance
 */

interface SendResult {
  success: boolean
  error?: string
}

// Cache per company (TTL 5 min)
const evoConfigCache = new Map<string, { data: EvoConfig | null; expires: number }>()

interface EvoConfig {
  apiUrl: string
  apiKey: string
  instance: string
}

async function getEvolutionConfig(companyId: string): Promise<EvoConfig | null> {
  const cached = evoConfigCache.get(companyId)
  if (cached && cached.expires > Date.now()) return cached.data

  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'whatsapp.evolution.' } },
  })

  const get = (key: string) => settings.find(s => s.key === key)?.value || ''

  const apiUrl = get('whatsapp.evolution.api_url') || process.env.EVOLUTION_API_URL || ''
  const apiKey = get('whatsapp.evolution.api_key') || process.env.EVOLUTION_API_KEY || ''
  const instance = get('whatsapp.evolution.instance') || process.env.EVOLUTION_INSTANCE || ''

  if (!apiUrl || !apiKey || !instance) {
    evoConfigCache.set(companyId, { data: null, expires: Date.now() + 5 * 60 * 1000 })
    return null
  }

  const data = { apiUrl, apiKey, instance }
  evoConfigCache.set(companyId, { data, expires: Date.now() + 5 * 60 * 1000 })
  return data
}

/**
 * Send text message via Evolution API (multi-tenant).
 * Fire-and-forget: failures are logged but don't throw.
 */
export async function sendWhatsAppEvolution(
  companyId: string,
  phone: string,
  text: string
): Promise<SendResult> {
  const config = await getEvolutionConfig(companyId)

  if (!config) {
    console.warn('[WhatsApp Evolution] Not configured for company', companyId)
    return { success: false, error: 'not_configured' }
  }

  // Format phone: ensure 55 prefix, remove non-digits
  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  try {
    const res = await fetch(`${config.apiUrl}/message/sendText/${encodeURIComponent(config.instance)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.apiKey,
      },
      body: JSON.stringify({
        number: formattedPhone,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[WhatsApp Evolution] Send error:', { status: res.status, err })
      return { success: false, error: `HTTP ${res.status}` }
    }

    return { success: true }
  } catch (err) {
    console.error('[WhatsApp Evolution] Send failed:', err)
    return { success: false, error: String(err) }
  }
}

/**
 * Legacy function — sends via global env config (no multi-tenant).
 * @deprecated Use sendWhatsAppEvolution(companyId, phone, text) instead.
 */
export async function sendWhatsApp(phone: string, text: string): Promise<SendResult> {
  const url = process.env.EVOLUTION_API_URL || ''
  const key = process.env.EVOLUTION_API_KEY || ''
  const instance = process.env.EVOLUTION_INSTANCE || 'pontualtech'

  if (!url || !key) {
    console.warn('[WhatsApp] Evolution API not configured, skipping')
    return { success: false, error: 'not_configured' }
  }

  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  try {
    const res = await fetch(`${url}/message/sendText/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
      },
      body: JSON.stringify({ number: formattedPhone, text }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[WhatsApp] Send error:', { status: res.status, err })
      return { success: false, error: `HTTP ${res.status}` }
    }

    return { success: true }
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err)
    return { success: false, error: String(err) }
  }
}
