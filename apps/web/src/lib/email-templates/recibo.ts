import 'server-only'
import { prisma } from '@pontual/db'

/**
 * Template de recibo de pagamento enviado ao cliente apos motorista
 * finalizar entrega com pagamento.
 *
 * Variaveis:
 *   {{cliente}} {{primeiro_nome}}
 *   {{empresa}}
 *   {{os_number}}
 *   {{valor}}                 ex: "R$ 285,00"
 *   {{forma_pagamento}}       ex: "Cartao de credito 3x"
 *   {{recebido_por}}          ex: "Carlos Silva"
 *   {{data_hora}}             ex: "23/04/2026 15:42"
 *   {{equipamento_completo}}  ex: "Impressora Epson L3250"
 *   {{serial_number}}         ex: "S3X-123456"
 *   {{garantia_ate}}          ex: "23/07/2026" (3 meses a frente)
 *   {{link_portal}}           https://portal.pontualtech.com.br/portal/pontualtech
 *   {{link_suporte}}          https://wa.me/551126263841
 */

export type ReciboVars = {
  cliente: string
  empresa: string
  os_number: string | number
  valor: string
  forma_pagamento: string
  recebido_por: string
  data_hora: string
  equipamento_completo: string
  serial_number: string
  garantia_ate: string
  link_portal: string
  link_suporte: string
  primeiro_nome?: string
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Recibo de pagamento — {{empresa}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#059669 0%,#0891b2 100%);padding:32px;color:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:12px;opacity:0.85;letter-spacing:1px;text-transform:uppercase;font-weight:600;">Recibo de Pagamento</p>
                    <h1 style="margin:4px 0 0 0;font-size:26px;font-weight:700;">{{empresa}}</h1>
                  </td>
                  <td align="right">
                    <div style="background:rgba(255,255,255,0.2);padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;">
                      OS #{{os_number}}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Saudacao -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <p style="margin:0 0 8px 0;font-size:16px;">Ola <strong>{{primeiro_nome}}</strong>,</p>
              <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.5;">Confirmamos o pagamento recebido na entrega do seu equipamento. Abaixo os detalhes do servico e sua garantia.</p>
            </td>
          </tr>

          <!-- Valor destacado -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px 0;font-size:11px;color:#065f46;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Valor pago</p>
                    <p style="margin:0;font-size:32px;font-weight:800;color:#065f46;line-height:1;">{{valor}}</p>
                    <p style="margin:6px 0 0 0;font-size:13px;color:#047857;">{{forma_pagamento}}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Detalhes -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 12px 0;font-size:11px;color:#6b7280;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Equipamento atendido</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;color:#1f2937;">
                <tr>
                  <td style="padding:6px 0;color:#6b7280;width:140px;">Modelo</td>
                  <td style="padding:6px 0;font-weight:600;text-align:right;">{{equipamento_completo}}</td>
                </tr>
                <tr><td colspan="2" style="border-top:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:6px 0;color:#6b7280;">Numero de serie</td>
                  <td style="padding:6px 0;font-family:monospace;font-weight:600;text-align:right;">{{serial_number}}</td>
                </tr>
                <tr><td colspan="2" style="border-top:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:6px 0;color:#6b7280;">Recebido por</td>
                  <td style="padding:6px 0;font-weight:500;text-align:right;">{{recebido_por}}</td>
                </tr>
                <tr><td colspan="2" style="border-top:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:6px 0;color:#6b7280;">Data do pagamento</td>
                  <td style="padding:6px 0;font-weight:500;text-align:right;">{{data_hora}}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Garantia -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eff6ff;border-left:4px solid #2563eb;border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px 0;font-size:11px;color:#1e40af;font-weight:600;letter-spacing:1px;text-transform:uppercase;">🛡️ Garantia de 3 meses</p>
                    <p style="margin:0;font-size:14px;color:#1e3a8a;line-height:1.5;">Seu servico tem garantia ate <strong>{{garantia_ate}}</strong>. Qualquer intercorrencia no mesmo defeito apresentado, entre em contato que resolvemos sem custo.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTAs -->
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:4px;" width="50%">
                    <a href="{{link_portal}}" target="_blank" style="display:block;text-align:center;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600;">Portal do Cliente</a>
                  </td>
                  <td style="padding:4px;" width="50%">
                    <a href="{{link_suporte}}" target="_blank" style="display:block;text-align:center;background:#22c55e;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600;">💬 Suporte WhatsApp</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px 28px 32px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.6;">Este e-mail serve como comprovante oficial de recebimento.<br>Duvidas? Responda este e-mail ou acione o suporte.</p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">© {{empresa}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

function render(html: string, vars: ReciboVars): string {
  const firstName = vars.primeiro_nome || (vars.cliente || '').split(' ')[0] || 'Cliente'
  return html
    .replace(/\{\{cliente\}\}/g, escapeHtml(vars.cliente))
    .replace(/\{\{primeiro_nome\}\}/g, escapeHtml(firstName))
    .replace(/\{\{empresa\}\}/g, escapeHtml(vars.empresa))
    .replace(/\{\{os_number\}\}/g, String(vars.os_number))
    .replace(/\{\{valor\}\}/g, escapeHtml(vars.valor))
    .replace(/\{\{forma_pagamento\}\}/g, escapeHtml(vars.forma_pagamento))
    .replace(/\{\{recebido_por\}\}/g, escapeHtml(vars.recebido_por))
    .replace(/\{\{data_hora\}\}/g, escapeHtml(vars.data_hora))
    .replace(/\{\{equipamento_completo\}\}/g, escapeHtml(vars.equipamento_completo))
    .replace(/\{\{serial_number\}\}/g, escapeHtml(vars.serial_number))
    .replace(/\{\{garantia_ate\}\}/g, escapeHtml(vars.garantia_ate))
    .replace(/\{\{link_portal\}\}/g, encodeURI(vars.link_portal))
    .replace(/\{\{link_suporte\}\}/g, encodeURI(vars.link_suporte))
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as string] || c
  ))
}

export async function getReciboEmail(
  companyId: string,
  vars: ReciboVars,
): Promise<{ subject: string; html: string }> {
  const [htmlSetting, subjectSetting] = await Promise.all([
    prisma.setting.findFirst({ where: { company_id: companyId, key: 'email_templates.recibo.html' } }),
    prisma.setting.findFirst({ where: { company_id: companyId, key: 'email_templates.recibo.subject' } }),
  ])
  const html = htmlSetting?.value || DEFAULT_HTML
  const subjectTpl = subjectSetting?.value || `Recibo de pagamento — OS #{{os_number}} | {{empresa}}`
  return {
    subject: render(subjectTpl, vars).replace(/<[^>]+>/g, ''),
    html: render(html, vars),
  }
}

export function getDefaultReciboTemplate() {
  return {
    html: DEFAULT_HTML,
    subject: 'Recibo de pagamento — OS #{{os_number}} | {{empresa}}',
  }
}
