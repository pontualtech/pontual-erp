/**
 * Sender: envia 1 email via Resend API.
 *
 * Por que nao reutilizar lib/send-email.ts sendCompanyEmail()?
 *   - sendCompanyEmail retorna boolean (perde resend_id pra tracking)
 *   - sendCompanyEmail nao aceita custom headers (List-Unsubscribe etc)
 *   - blast precisa de reply_to dedicado por campanha
 *
 * Headers padrao (List-Unsubscribe + Unsubscribe-Post) ativam o botao
 * nativo "Cancelar inscricao" do Gmail/Outlook. RFC 8058.
 */
import { prisma } from '@pontual/db'
import type { SendResult } from './types'

interface SendBlastArgs {
  companyId: string
  to: string
  subject: string
  html: string
  fromEmail: string
  replyTo: string
}

/**
 * Pega API key do Resend via Settings da company (com fallback env).
 * Cache simples in-process (5min).
 */
const apiKeyCache = new Map<string, { key: string; expires: number }>()
const CACHE_TTL = 5 * 60 * 1000

async function getResendApiKey(companyId: string): Promise<string> {
  const cached = apiKeyCache.get(companyId)
  if (cached && cached.expires > Date.now()) return cached.key

  const setting = await prisma.setting.findFirst({
    where: { company_id: companyId, key: 'email.resend_api_key' },
  })
  const key = setting?.value || process.env.RESEND_API_KEY || ''
  apiKeyCache.set(companyId, { key, expires: Date.now() + CACHE_TTL })
  return key
}

export async function sendBlastEmail(args: SendBlastArgs): Promise<SendResult> {
  const apiKey = await getResendApiKey(args.companyId)
  if (!apiKey) {
    return { ok: false, error: 'resend_api_key_missing' }
  }

  // List-Unsubscribe pra ativar botao nativo Gmail/Outlook + RFC 8058 one-click
  const unsubscribeUrl = `https://pontualtech.com.br/descadastrar.html?email=${encodeURIComponent(args.to)}`
  const unsubscribeMailto = `mailto:unsubscribe@pontualtech.com.br?subject=Descadastrar`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: args.fromEmail,
        to: args.to,
        subject: args.subject,
        html: args.html,
        reply_to: args.replyTo,
        headers: {
          'List-Unsubscribe': `<${unsubscribeMailto}>, <${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = (data as any).message || (data as any).error || `http_${res.status}`
      return { ok: false, error: String(msg).slice(0, 500) }
    }

    return { ok: true, resend_id: (data as any).id || undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 500) : 'network_error' }
  }
}

/**
 * Personaliza HTML do template. Mesmo padrao dos scripts send_email*.js.
 * {{firstname}}, {{firstname_amigo}}, links wa.me, webview, etc.
 */
export function personalizeHtml(
  html: string,
  contact: { name?: string | null; email: string },
  config: { utmCampaign: string; webviewUrl?: string; waUrl?: string },
): string {
  const firstName = (contact.name || '').trim().split(/\s+/)[0] || ''
  const greeting = firstName ? capitalize(firstName) : 'Olá'
  const greetingAmigo = firstName ? capitalize(firstName) : 'amigo'

  const utm = `utm_source=email&utm_medium=blast&utm_campaign=${encodeURIComponent(config.utmCampaign)}`
  const webview = config.webviewUrl
    ? `${config.webviewUrl}${config.webviewUrl.includes('?') ? '&' : '?'}${utm}`
    : ''

  let out = html
    .replaceAll('{contactfield=firstname|Olá}', greeting)
    .replaceAll('{contactfield=firstname|amigo}', greetingAmigo)
    .replaceAll('{{firstname}}', greeting)
    .replaceAll('{{webview_url}}', webview)

  if (config.waUrl) {
    out = out.replace(/href="https:\/\/wa\.me\/[^"]+"/g, `href="${config.waUrl}"`)
  }
  return out
}

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
