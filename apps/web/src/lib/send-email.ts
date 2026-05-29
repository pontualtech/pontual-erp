import { prisma } from '@pontual/db'
import { createTransport } from 'nodemailer'

// ─────────────────────────────────────────────
// Email config cache (per company, TTL 5min)
// ─────────────────────────────────────────────
interface EmailConfig {
  provider: 'resend' | 'smtp'
  fromName: string
  fromAddress: string
  // Resend
  resendApiKey?: string
  // SMTP
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  smtpPass?: string
  smtpSecure?: boolean // true = TLS (465), false = STARTTLS (587)
}

const configCache = new Map<string, { config: EmailConfig; expires: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getEmailConfig(companyId: string): Promise<EmailConfig> {
  // Check cache
  const cached = configCache.get(companyId)
  if (cached && cached.expires > Date.now()) return cached.config

  // Load from Settings table
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'email.' } },
  })

  const get = (key: string) => settings.find(s => s.key === key)?.value || ''

  const provider = (get('email.provider') || 'resend') as 'resend' | 'smtp'
  const config: EmailConfig = {
    provider,
    fromName: get('email.from_name') || get('company_name') || 'Sistema',
    fromAddress: get('email.from_address') || '',
    resendApiKey: get('email.resend_api_key') || process.env.RESEND_API_KEY || '',
    smtpHost: get('email.smtp_host') || '',
    smtpPort: parseInt(get('email.smtp_port') || '587'),
    smtpUser: get('email.smtp_user') || '',
    smtpPass: get('email.smtp_pass') || '',
    smtpSecure: get('email.smtp_secure') === 'true',
  }

  // Cache
  configCache.set(companyId, { config, expires: Date.now() + CACHE_TTL })
  return config
}

/**
 * Clear email config cache (call when settings are updated)
 */
export function clearEmailConfigCache(companyId?: string) {
  if (companyId) configCache.delete(companyId)
  else configCache.clear()
}

// Opts opcionais comuns a Resend/SMTP — passados via sendCompanyEmail.
// unsubscribeUrl → injeta headers RFC 8058 (List-Unsubscribe + One-Click)
// pra ativar botão nativo Gmail/Outlook/Yahoo. replyTo → Reply-To header.
interface SendOpts {
  unsubscribeUrl?: string
  replyTo?: string
}

function buildListUnsubHeaders(unsubscribeUrl?: string): Record<string, string> | undefined {
  if (!unsubscribeUrl) return undefined
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

// ─────────────────────────────────────────────
// Send via Resend API
// ─────────────────────────────────────────────
async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  opts?: SendOpts,
): Promise<boolean> {
  try {
    const headers = buildListUnsubHeaders(opts?.unsubscribeUrl)
    const payload: any = { from, to, subject, html }
    if (headers) payload.headers = headers
    if (opts?.replyTo) payload.reply_to = opts.replyTo

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[Email:Resend] Error:', err)
    }

    return res.ok
  } catch (err) {
    console.error('[Email:Resend] Failed:', err)
    return false
  }
}

// ─────────────────────────────────────────────
// Send via SMTP (nodemailer)
// ─────────────────────────────────────────────
async function sendViaSMTP(
  config: EmailConfig,
  from: string,
  to: string,
  subject: string,
  html: string,
  opts?: SendOpts,
): Promise<boolean> {
  try {
    const transport = createTransport({
      host: config.smtpHost,
      port: config.smtpPort || 587,
      secure: config.smtpSecure || false,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
      tls: {
        rejectUnauthorized: false, // Allow self-signed certs (common in shared hosting)
      },
    })

    const headers = buildListUnsubHeaders(opts?.unsubscribeUrl)
    const mail: any = { from, to, subject, html }
    if (headers) mail.headers = headers
    if (opts?.replyTo) mail.replyTo = opts.replyTo

    await transport.sendMail(mail)
    return true
  } catch (err) {
    console.error('[Email:SMTP] Failed:', err)
    return false
  }
}

// ─────────────────────────────────────────────
// Public API — Multi-tenant email sending
// ─────────────────────────────────────────────

// RFC 5322: nomes com non-ASCII (acentos, emoji) precisam encoding pra
// MTAs conservadores (Outlook on-prem, Yahoo legacy). Encoding RFC 2047
// "encoded-word" base64 UTF-8.
function encodeFromName(name: string): string {
  // ASCII puro? Quote simples e segue.
  if (/^[\x20-\x7E]*$/.test(name)) return name
  const b64 = Buffer.from(name, 'utf-8').toString('base64')
  return `=?UTF-8?B?${b64}?=`
}

/**
 * Send email using company-specific configuration.
 * Automatically routes to Resend or SMTP based on company settings.
 *
 * @param companyId - Company UUID (loads config from Settings table)
 * @param to - Recipient email
 * @param subject - Email subject
 * @param html - HTML body
 * @param fromOverride - Optional sender override (format: "Name <email>")
 * @param opts - Optional send opts (unsubscribeUrl, replyTo)
 */
export async function sendCompanyEmail(
  companyId: string,
  to: string,
  subject: string,
  html: string,
  fromOverride?: string,
  opts?: SendOpts,
): Promise<boolean> {
  const config = await getEmailConfig(companyId)

  const encodedName = encodeFromName(config.fromName)
  const from = fromOverride || `${encodedName} <${config.fromAddress}>`
  // Default replyTo = fromAddress (sem nome — só endereço resolve "Responder").
  const effectiveOpts: SendOpts = {
    ...opts,
    replyTo: opts?.replyTo || config.fromAddress || undefined,
  }

  if (config.provider === 'smtp' && config.smtpHost) {
    console.log(`[Email] Sending via SMTP (${config.smtpHost}) to ${to}`)
    return sendViaSMTP(config, from, to, subject, html, effectiveOpts)
  }

  // Default: Resend
  const apiKey = config.resendApiKey || process.env.RESEND_API_KEY || ''
  if (!apiKey) {
    console.error('[Email] No email provider configured for company', companyId)
    return false
  }

  console.log(`[Email] Sending via Resend to ${to}`)
  return sendViaResend(apiKey, from, to, subject, html, effectiveOpts)
}

/**
 * Legacy sendEmail — backward compatible.
 * Uses global Resend config (for endpoints that don't have company context yet).
 * New code should use sendCompanyEmail() instead.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  from?: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[Email] RESEND_API_KEY not configured')
    return false
  }

  const sender = from || process.env.EMAIL_FROM || 'PontualTech <contato@pontualtech.com.br>'
  return sendViaResend(apiKey, sender, to, subject, html)
}
