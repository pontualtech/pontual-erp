import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

const DEFAULT_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
  <h2 style="margin:0 0 4px;color:#1e293b;">{{company_name}}</h2>
  <p style="margin:0 0 20px;font-size:12px;color:#64748b;">CNPJ: {{company_cnpj}} | Tel: {{company_phone}}</p>

  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:20px;margin-bottom:16px;">
    <h3 style="margin:0 0 16px;font-size:18px;color:#1e293b;">OS-{{os_number}}</h3>

    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#64748b;width:140px;">Status:</td><td style="padding:6px 0;font-weight:600;">{{status}}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Data Abertura:</td><td style="padding:6px 0;">{{created_at}}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Equipamento:</td><td style="padding:6px 0;">{{equipment_type}} {{equipment_brand}} {{equipment_model}}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">N. Serie:</td><td style="padding:6px 0;">{{serial_number}}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Problema:</td><td style="padding:6px 0;">{{reported_issue}}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Diagnostico:</td><td style="padding:6px 0;">{{diagnosis}}</td></tr>
    </table>
  </div>

  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:16px;text-align:center;margin-bottom:16px;">
    <p style="margin:0 0 4px;font-size:12px;color:#3b82f6;font-weight:600;">VALOR TOTAL</p>
    <p style="margin:0;font-size:24px;font-weight:bold;color:#1e40af;">{{total_cost}}</p>
    <p style="margin:4px 0 0;font-size:11px;color:#64748b;">Pecas: {{total_parts}} | Servicos: {{total_services}}</p>
  </div>

  <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0;">
    {{company_name}} - {{company_address}}<br>
    {{company_email}} | {{company_phone}}
  </p>
</div>
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
          from: smtpFrom || `${companyName} <noreply@pontualtech.work>`,
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
