import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

const DEFAULT_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 50%,#3b82f6 100%);padding:32px;text-align:center;">
              <h1 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:800;">{{company_name}}</h1>
              <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;">Assistencia Tecnica em Informatica</p>
            </td>
          </tr>
          <!-- BODY -->
          <tr>
            <td style="padding:32px;">
              <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
                <div style="background:#eff6ff;padding:14px 16px;border-bottom:2px solid #e2e8f0;">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td><p style="margin:0;font-size:18px;font-weight:800;color:#1e293b;">OS-{{os_number}}</p></td>
                    <td style="text-align:right;"><p style="margin:0;font-size:12px;color:#2563eb;font-weight:700;">{{status}}</p></td>
                  </tr></table>
                </div>
                <div style="padding:16px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#1e293b;">
                    <tr><td style="padding:6px 0;color:#64748b;font-weight:700;width:130px;">Data Abertura:</td><td style="padding:6px 0;">{{created_at}}</td></tr>
                    <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Equipamento:</td><td style="padding:6px 0;font-weight:600;">{{equipment_type}} {{equipment_brand}} {{equipment_model}}</td></tr>
                    <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">N. Serie:</td><td style="padding:6px 0;">{{serial_number}}</td></tr>
                    <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Problema:</td><td style="padding:6px 0;">{{reported_issue}}</td></tr>
                    <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Diagnostico:</td><td style="padding:6px 0;">{{diagnosis}}</td></tr>
                  </table>
                </div>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:10px;padding:20px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Valor Total</p>
                    <p style="margin:0;font-size:28px;font-weight:800;color:#ffffff;">{{total_cost}}</p>
                    <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.6);">Pecas: {{total_parts}} | Servicos: {{total_services}}</p>
                  </td>
                </tr>
              </table>

              <div style="text-align:center;margin-bottom:24px;">
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#25d366;border-radius:8px;">
                  <a href="https://wa.me/551126263841" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;">
                    Fale com nosso suporte
                  </a>
                </td></tr></table>
              </div>
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td style="background:#1e293b;padding:24px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">{{company_name}}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">{{company_address}}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">CNPJ: {{company_cnpj}} | Tel: {{company_phone}} | {{company_email}}</p>
              <div style="border-top:1px solid #334155;padding-top:10px;margin-top:10px;">
                <p style="margin:0;font-size:10px;color:#64748b;">⚙️ Esta e uma mensagem automatica. Nao responda diretamente este email.</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(date: Date | string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('pt-BR')
}

function replaceTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '—')
  }
  return result
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const { to, subject } = body as { to?: string; subject?: string }

    // Load OS
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: true,
        service_order_items: { where: { deleted_at: null } },
        module_statuses: true,
      },
    })

    if (!os) return error('OS nao encontrada', 404)

    const recipientEmail = to || os.customers?.email
    if (!recipientEmail) {
      return error('Email do cliente nao informado. Informe o email no campo "to".', 400)
    }

    // Check SMTP configuration
    const smtpHost = process.env.SMTP_HOST
    const smtpUser = process.env.SMTP_USER
    const smtpPass = process.env.SMTP_PASS
    const smtpFrom = process.env.SMTP_FROM || smtpUser
    const resendKey = process.env.RESEND_API_KEY

    if (!resendKey && (!smtpHost || !smtpUser || !smtpPass)) {
      // Log that email would be sent (for MVP)
      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'os',
        action: 'email_pending',
        entityId: os.id,
        newValue: {
          to: recipientEmail,
          os_number: os.os_number,
          message: 'Email nao enviado: SMTP/Resend nao configurado. Configure SMTP_HOST, SMTP_USER, SMTP_PASS ou RESEND_API_KEY nas variaveis de ambiente.',
        },
      })

      return error(
        'Email nao configurado. Configure as variaveis de ambiente SMTP_HOST, SMTP_USER, SMTP_PASS (ou RESEND_API_KEY) no servidor.',
        503
      )
    }

    // Load company
    const company = await prisma.company.findFirst({
      where: { id: user.companyId },
    })

    // Load company settings
    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId },
    })
    const settingsMap: Record<string, string> = {}
    for (const s of settings) {
      settingsMap[s.key] = s.value
    }

    // Load email template
    const msgTemplate = await prisma.messageTemplate.findFirst({
      where: { company_id: user.companyId, trigger: 'os_created', channel: 'email', is_active: true },
    })

    const htmlTemplate = msgTemplate?.template || DEFAULT_EMAIL_TEMPLATE

    const c = os.customers
    const customerAddress = c
      ? [c.address_street, c.address_number, c.address_complement, c.address_neighborhood, c.address_city, c.address_state, c.address_zip]
          .filter(Boolean)
          .join(', ')
      : '—'

    const companyAddress = settingsMap['company.address'] ||
      settingsMap['endereco'] ||
      [settingsMap['company.street'], settingsMap['company.number'], settingsMap['company.city'], settingsMap['company.state']]
        .filter(Boolean)
        .join(', ') || '—'

    const companyName = company?.name || settingsMap['company.name'] || 'PontualTech'
    const osNumber = String(os.os_number).padStart(4, '0')

    const vars: Record<string, string> = {
      os_number: osNumber,
      customer_name: c?.legal_name || '—',
      customer_document: c?.document_number || '—',
      customer_phone: c?.mobile || c?.phone || '—',
      customer_email: c?.email || '—',
      customer_address: customerAddress,
      equipment_type: os.equipment_type || '—',
      equipment_brand: os.equipment_brand || '',
      equipment_model: os.equipment_model || '',
      serial_number: os.serial_number || '—',
      reported_issue: os.reported_issue || '—',
      diagnosis: os.diagnosis || '—',
      items_table: '',
      total_parts: fmtCents(os.total_parts ?? 0),
      total_services: fmtCents(os.total_services ?? 0),
      total_cost: fmtCents(os.total_cost ?? 0),
      status: os.module_statuses?.name || '—',
      created_at: fmtDate(os.created_at),
      company_name: companyName,
      company_phone: settingsMap['company.phone'] || settingsMap['telefone'] || '—',
      company_email: settingsMap['company.email'] || settingsMap['email'] || '—',
      company_address: companyAddress,
      company_cnpj: settingsMap['company.cnpj'] || settingsMap['cnpj'] || '—',
    }

    const htmlBody = replaceTemplateVars(htmlTemplate, vars)
    const emailSubject = subject || `OS-${osNumber} - ${companyName}`

    // Send via Resend API (HTTP POST, no npm package needed)
    if (resendKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || smtpFrom || 'PontualTech <contato@pontualtech.com.br>',
          to: [recipientEmail],
          subject: emailSubject,
          html: htmlBody,
        }),
      })

      if (!res.ok) {
        const resErr = await res.json().catch(() => ({}))
        console.error('[EMAIL] Resend error:', resErr)
        return error(`Erro ao enviar email via Resend: ${(resErr as any).message || res.statusText}`, 500)
      }

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'os',
        action: 'email_sent',
        entityId: os.id,
        newValue: { to: recipientEmail, subject: emailSubject, provider: 'resend' },
      })

      return success({ sent: true, to: recipientEmail, subject: emailSubject })
    }

    // No email provider configured
    return error('Email nao configurado. Configure RESEND_API_KEY nas variaveis de ambiente do Coolify, ou configure SMTP_HOST + SMTP_USER + SMTP_PASS.', 503)
  } catch (err) {
    return handleError(err)
  }
}
