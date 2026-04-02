/**
 * Utilitário para envio de email via Resend API
 *
 * @param to - Destinatário
 * @param subject - Assunto
 * @param html - Corpo HTML
 * @param from - Remetente (opcional). Se não informado, usa EMAIL_FROM env var.
 *               Formato: "Nome <email@dominio.com>"
 */
export async function sendEmail(to: string, subject: string, html: string, from?: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[Email] RESEND_API_KEY not configured')
    return false
  }

  const sender = from || process.env.EMAIL_FROM || 'PontualTech <contato@pontualtech.com.br>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: sender, to, subject, html }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[Email] Resend error:', err)
    }

    return res.ok
  } catch (err) {
    console.error('[Email] Send failed:', err)
    return false
  }
}
