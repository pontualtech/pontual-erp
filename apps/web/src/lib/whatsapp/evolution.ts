const API_URL = () => process.env.EVOLUTION_API_URL || ''
const API_KEY = () => process.env.EVOLUTION_API_KEY || ''
const INSTANCE = () => process.env.EVOLUTION_INSTANCE || 'pontualtech'

interface SendResult {
  success: boolean
  error?: string
}

/**
 * Send text message via Evolution API
 * Fire-and-forget: failures are logged but don't throw
 */
export async function sendWhatsApp(phone: string, text: string): Promise<SendResult> {
  const url = API_URL()
  const key = API_KEY()

  if (!url || !key) {
    console.warn('[WhatsApp] Evolution API not configured, skipping')
    return { success: false, error: 'not_configured' }
  }

  // Format phone: ensure 55 prefix, remove non-digits
  const cleanPhone = phone.replace(/\D/g, '')
  const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`

  try {
    const res = await fetch(`${url}/message/sendText/${INSTANCE()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
      },
      body: JSON.stringify({
        number: formattedPhone,
        text,
      }),
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
