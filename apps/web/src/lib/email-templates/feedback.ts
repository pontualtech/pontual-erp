import 'server-only'
import { prisma } from '@pontual/db'

/**
 * Template de e-mail "Solicitar avaliacao apos entrega".
 *
 * Pode ser sobrescrito por empresa via setting `email_templates.feedback`
 * (HTML completo com variaveis {{var}}). Se nao houver override, usa
 * DEFAULT — design responsivo, cores neutras, call-to-action destacado.
 *
 * Variaveis suportadas:
 *   {{cliente}}       nome do cliente
 *   {{empresa}}       nome da empresa
 *   {{os_number}}     numero da OS
 *   {{link}}          URL de avaliacao (com token de cupom)
 *   {{primeiro_nome}} primeiro nome do cliente
 */
export type FeedbackVars = {
  cliente: string
  empresa: string
  os_number: string | number
  link: string
  primeiro_nome?: string
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Como foi o atendimento?</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:36px 32px;color:#ffffff;text-align:center;">
              <div style="font-size:42px;line-height:1;margin-bottom:8px;">⭐</div>
              <h1 style="margin:0;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Como foi o atendimento?</h1>
              <p style="margin:6px 0 0 0;font-size:13px;opacity:0.9;">Sua opiniao vale muito pra {{empresa}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.6;">
              <p style="margin:0 0 12px 0;">Ola <strong>{{primeiro_nome}}</strong>,</p>
              <p style="margin:0 0 16px 0;">Acabamos de concluir o servico da OS <strong>#{{os_number}}</strong>. Queriamos saber: como foi a experiencia?</p>
              <p style="margin:0 0 24px 0;">Leva menos de 1 minuto pra avaliar nosso atendimento no Google. Como forma de agradecimento pelo feedback, voce ganha <strong>10% de desconto</strong> no proximo servico ou produto.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 0;">
                    <a href="{{link}}" target="_blank" style="display:inline-block;background-color:#4f46e5;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:10px;box-shadow:0 2px 6px rgba(79,70,229,0.25);">Avaliar e ganhar 10%</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;text-align:center;">Se o botao nao abrir, copie e cole no navegador:<br><span style="color:#4f46e5;word-break:break-all;">{{link}}</span></p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">Duvidas? Responda este e-mail.</p>
              <p style="margin:6px 0 0 0;font-size:11px;color:#d1d5db;">{{empresa}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

function render(html: string, vars: FeedbackVars): string {
  const firstName = vars.primeiro_nome || (vars.cliente || '').split(' ')[0] || 'Cliente'
  return html
    .replace(/\{\{cliente\}\}/g, escapeHtml(vars.cliente))
    .replace(/\{\{primeiro_nome\}\}/g, escapeHtml(firstName))
    .replace(/\{\{empresa\}\}/g, escapeHtml(vars.empresa))
    .replace(/\{\{os_number\}\}/g, String(vars.os_number))
    .replace(/\{\{link\}\}/g, encodeURI(vars.link))
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as string] || c
  ))
}

/** HTML + assunto do e-mail, com template custom da empresa se existir. */
export async function getFeedbackEmail(
  companyId: string,
  vars: FeedbackVars,
): Promise<{ subject: string; html: string }> {
  const [htmlSetting, subjectSetting] = await Promise.all([
    prisma.setting.findFirst({ where: { company_id: companyId, key: 'email_templates.feedback.html' } }),
    prisma.setting.findFirst({ where: { company_id: companyId, key: 'email_templates.feedback.subject' } }),
  ])
  const html = htmlSetting?.value || DEFAULT_HTML
  const subjectTpl = subjectSetting?.value || `Como foi o atendimento da {{empresa}}? — OS #{{os_number}}`
  return {
    subject: render(subjectTpl, vars).replace(/<[^>]+>/g, ''), // strip tags do subject
    html: render(html, vars),
  }
}

export function getDefaultFeedbackTemplate() {
  return {
    html: DEFAULT_HTML,
    subject: 'Como foi o atendimento da {{empresa}}? — OS #{{os_number}}',
  }
}
