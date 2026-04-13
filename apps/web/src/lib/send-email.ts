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

// ─────────────────────────────────────────────
// Send via Resend API
// ─────────────────────────────────────────────
async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
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
  html: string
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

    await transport.sendMail({ from, to, subject, html })
    return true
  } catch (err) {
    console.error('[Email:SMTP] Failed:', err)
    return false
  }
}

// ─────────────────────────────────────────────
// Public API — Multi-tenant email sending
// ─────────────────────────────────────────────

/**
 * Send email using company-specific configuration.
 * Automatically routes to Resend or SMTP based on company settings.
 *
 * @param companyId - Company UUID (loads config from Settings table)
 * @param to - Recipient email
 * @param subject - Email subject
 * @param html - HTML body
 * @param fromOverride - Optional sender override (format: "Name <email>")
 */
export async function sendCompanyEmail(
  companyId: string,
  to: string,
  subject: string,
  html: string,
  fromOverride?: string,
): Promise<boolean> {
  const config = await getEmailConfig(companyId)

  const from = fromOverride || `${config.fromName} <${config.fromAddress}>`

  if (config.provider === 'smtp' && config.smtpHost) {
    console.log(`[Email] Sending via SMTP (${config.smtpHost}) to ${to}`)
    return sendViaSMTP(config, from, to, subject, html)
  }

  // Default: Resend
  const apiKey = config.resendApiKey || process.env.RESEND_API_KEY || ''
  if (!apiKey) {
    console.error('[Email] No email provider configured for company', companyId)
    return false
  }

  console.log(`[Email] Sending via Resend to ${to}`)
  return sendViaResend(apiKey, from, to, subject, html)
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
