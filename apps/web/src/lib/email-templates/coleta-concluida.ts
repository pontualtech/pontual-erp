import 'server-only'
import { prisma } from '@pontual/db'

/**
 * Template "Coleta concluida" — enviado apos motorista finalizar a
 * coleta. Mostra todos os dados capturados no app (modelo, serial,
 * assinatura, foto, recebido por, data) e avisa que o orcamento
 * chegara por e-mail em seguida.
 *
 * Variaveis suportadas (todas renderizadas com escapeHtml exceto
 * assinatura e foto, que sao img tags geradas fora da interpolacao):
 *   {{cliente}} {{primeiro_nome}}
 *   {{empresa}}
 *   {{os_number}}
 *   {{equipamento_completo}}  "Impressora Epson L3250"
 *   {{serial_number}}
 *   {{defeito_reportado}}
 *   {{recebido_por}}
 *   {{data_hora}}              "23/04/2026 15:42"
 *   {{checklist_html}}         lista <ul><li> ja renderizada (ou vazio)
 *   {{assinatura_img}}         <img data:image/png> da assinatura
 *   {{foto_img}}               <img> da primeira foto extra (ou vazio)
 *   {{link_portal}}
 *   {{link_suporte}}
 */

export type ColetaConcluidaVars = {
  cliente: string
  empresa: string
  os_number: string | number
  equipamento_completo: string
  serial_number: string
  defeito_reportado: string
  recebido_por: string
  data_hora: string
  checklist: Array<{ label: string; checked: boolean }>
  signature_url: string | null
  photo_url: string | null
  link_portal: string
  link_suporte: string
  primeiro_nome?: string
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Coleta concluida — {{empresa}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px;color:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:12px;opacity:0.85;letter-spacing:1px;text-transform:uppercase;font-weight:600;">Comprovante de Coleta</p>
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
              <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.55;">Coletamos seu equipamento com sucesso! Nossa equipe ja esta analisando e em breve voce vai receber o <strong>orcamento por e-mail</strong>. Abaixo, todos os dados registrados no momento da coleta.</p>
            </td>
          </tr>

          <!-- Equipamento -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <p style="margin:0 0 10px 0;font-size:11px;color:#6b7280;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Equipamento coletado</p>
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
                  <td style="padding:6px 0;color:#6b7280;vertical-align:top;">Defeito reportado</td>
                  <td style="padding:6px 0;font-weight:500;text-align:right;">{{defeito_reportado}}</td>
                </tr>
                <tr><td colspan="2" style="border-top:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:6px 0;color:#6b7280;">Coletado de</td>
                  <td style="padding:6px 0;font-weight:500;text-align:right;">{{recebido_por}}</td>
                </tr>
                <tr><td colspan="2" style="border-top:1px solid #f3f4f6;"></td></tr>
                <tr>
                  <td style="padding:6px 0;color:#6b7280;">Data/hora</td>
                  <td style="padding:6px 0;font-weight:500;text-align:right;">{{data_hora}}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Checklist -->
          {{checklist_block}}

          <!-- Foto -->
          {{foto_block}}

          <!-- Assinatura -->
          {{assinatura_block}}

          <!-- Proximo passo -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px 0;font-size:11px;color:#92400e;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Proximo passo</p>
                    <p style="margin:0;font-size:14px;color:#78350f;line-height:1.5;">Em breve voce vai receber o <strong>orcamento por e-mail</strong>. Basta aprovar pelo portal do cliente para iniciarmos o reparo.</p>
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
                    <a href="{{link_suporte}}" target="_blank" style="display:block;text-align:center;background:#22c55e;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600;">Suporte WhatsApp</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px 28px 32px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.6;">Este e-mail confirma que coletamos seu equipamento.<br>Duvidas? Responda este e-mail ou acione o suporte.</p>
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

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as string] || c
  ))
}

function render(html: string, vars: ColetaConcluidaVars): string {
  const firstName = vars.primeiro_nome || (vars.cliente || '').split(' ')[0] || 'Cliente'

  // Blocos condicionais renderizados como <tr> completos
  const checklistBlock = vars.checklist && vars.checklist.length
    ? `<tr><td style="padding:24px 32px 0 32px;">
         <p style="margin:0 0 10px 0;font-size:11px;color:#6b7280;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Checklist de coleta</p>
         <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#374151;line-height:1.7;">
           ${vars.checklist.map(c => `<li style="list-style:${c.checked ? 'none' : 'disc'};">
             ${c.checked ? '&#9989; ' : '&#10060; '}${escapeHtml(c.label)}
           </li>`).join('')}
         </ul>
       </td></tr>`
    : ''

  const fotoBlock = vars.photo_url
    ? `<tr><td style="padding:24px 32px 0 32px;">
         <p style="margin:0 0 10px 0;font-size:11px;color:#6b7280;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Foto no momento da coleta</p>
         <img src="${vars.photo_url}" alt="Equipamento"
              style="width:100%;max-width:536px;border-radius:12px;border:1px solid #e5e7eb;display:block;" />
       </td></tr>`
    : ''

  const assinaturaBlock = vars.signature_url
    ? `<tr><td style="padding:24px 32px 0 32px;">
         <p style="margin:0 0 10px 0;font-size:11px;color:#6b7280;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Assinatura de quem entregou</p>
         <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:8px;">
           <img src="${vars.signature_url}" alt="Assinatura"
                style="width:100%;max-width:520px;display:block;" />
         </div>
         <p style="margin:8px 0 0 0;font-size:12px;color:#6b7280;text-align:right;">
           Assinado por <strong>${escapeHtml(vars.recebido_por)}</strong>
         </p>
       </td></tr>`
    : ''

  return html
    .replace(/\{\{cliente\}\}/g, escapeHtml(vars.cliente))
    .replace(/\{\{primeiro_nome\}\}/g, escapeHtml(firstName))
    .replace(/\{\{empresa\}\}/g, escapeHtml(vars.empresa))
    .replace(/\{\{os_number\}\}/g, String(vars.os_number))
    .replace(/\{\{equipamento_completo\}\}/g, escapeHtml(vars.equipamento_completo))
    .replace(/\{\{serial_number\}\}/g, escapeHtml(vars.serial_number))
    .replace(/\{\{defeito_reportado\}\}/g, escapeHtml(vars.defeito_reportado))
    .replace(/\{\{recebido_por\}\}/g, escapeHtml(vars.recebido_por))
    .replace(/\{\{data_hora\}\}/g, escapeHtml(vars.data_hora))
    .replace(/\{\{checklist_block\}\}/g, checklistBlock)
    .replace(/\{\{foto_block\}\}/g, fotoBlock)
    .replace(/\{\{assinatura_block\}\}/g, assinaturaBlock)
    .replace(/\{\{link_portal\}\}/g, encodeURI(vars.link_portal))
    .replace(/\{\{link_suporte\}\}/g, encodeURI(vars.link_suporte))
}

export async function getColetaConcluidaEmail(
  companyId: string,
  vars: ColetaConcluidaVars,
): Promise<{ subject: string; html: string }> {
  const [htmlSetting, subjectSetting] = await Promise.all([
    prisma.setting.findFirst({ where: { company_id: companyId, key: 'email_templates.coleta_concluida.html' } }),
    prisma.setting.findFirst({ where: { company_id: companyId, key: 'email_templates.coleta_concluida.subject' } }),
  ])
  const html = htmlSetting?.value || DEFAULT_HTML
  const subjectTpl = subjectSetting?.value || `Coletamos seu equipamento — OS #{{os_number}} | {{empresa}}`
  return {
    subject: render(subjectTpl, vars).replace(/<[^>]+>/g, ''),
    html: render(html, vars),
  }
}

export function getDefaultColetaConcluidaTemplate() {
  return {
    html: DEFAULT_HTML,
    subject: 'Coletamos seu equipamento — OS #{{os_number}} | {{empresa}}',
  }
}
