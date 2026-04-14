import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendCompanyEmail } from '@/lib/send-email'
import { createHmac } from 'crypto'
import { createAccessToken } from '@/lib/portal-auth'
import { escapeHtml } from '@/lib/escape-html'

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function generateOrcamentoToken(osId: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY nao configurada')
  return createHmac('sha256', key).update('orcamento:' + osId).digest('hex').slice(0, 16)
}

function replaceTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '—')
  }
  return result
}

function daysSince(date: Date): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)))
}

const DEFAULT_QUOTE_REMINDER_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 50%,#3b82f6 100%);padding:36px 32px;text-align:center;">
              <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;margin:0 auto 12px;line-height:56px;font-size:28px;">&#128203;</div>
              <h1 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:800;">Orcamento Pendente</h1>
              <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;">{{company_name}}</p>
            </td>
          </tr>
          <!-- BODY -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;color:#1e293b;">
                Prezado(a) <strong>{{customer_name}}</strong>,
              </p>
              <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7;">
                O orcamento da sua <strong>OS-{{os_number}}</strong> esta aguardando sua aprovacao ha <strong>{{days_waiting}} dias</strong>.
              </p>
              <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
                <div style="padding:16px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr><td style="padding:6px 0;vertical-align:top;"><p style="margin:0 0 2px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Equipamento</p><p style="margin:0;font-size:15px;color:#1e293b;font-weight:600;">{{equipment}}</p></td></tr>
                    <tr><td style="padding:12px 0 0;border-top:1px solid #f1f5f9;vertical-align:top;"><p style="margin:0 0 2px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Diagnostico</p><p style="margin:0;font-size:14px;color:#334155;line-height:1.5;">{{diagnosis}}</p></td></tr>
                  </table>
                </div>
              </div>
              {{items_table}}
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:10px;padding:20px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Orcamento Pendente</p>
                    <p style="margin:0;font-size:18px;font-weight:800;color:#ffffff;">Acesse o painel para ver os valores</p>
                  </td>
                </tr>
              </table>
              <!-- MOTIVATIONAL CTA - Portal -->
              <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:14px;padding:28px 20px;margin-bottom:20px;text-align:center;">
                <p style="margin:0 0 8px;font-size:17px;font-weight:800;color:#ffffff;">Seu equipamento esta esperando!</p>
                <p style="margin:0 0 20px;font-size:13px;color:#94a3b8;line-height:1.6;">
                  Acesse seu Painel para ver o diagnostico completo, aprovar o servico e acompanhar tudo em tempo real.
                </p>
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                  <td style="background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:10px;box-shadow:0 4px 16px rgba(34,197,94,0.4);">
                    <a href="{{portal_os_link}}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;padding:16px 40px;">
                      ACESSAR MEU PAINEL
                    </a>
                  </td>
                </tr></table>
              </div>
              <div style="text-align:center;margin:0 0 24px;">
                <a href="{{rejection_link}}" style="color:#dc2626;font-size:12px;text-decoration:underline;">
                  Nao tenho interesse
                </a>
              </div>
              <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
                Precisa de ajuda? <a href="https://wa.me/{{company_whatsapp}}" style="color:#94a3b8;text-decoration:underline;">Fale conosco</a> | {{company_phone}}
              </p>
            </td>
          </tr>
          <!-- ACOMPANHE SUA OS -->
          <tr><td style="padding:0 32px 24px;">
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
              <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                <td style="padding:0 6px;"><a href="{{portal_os_link}}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
                <td style="padding:0 6px;"><a href="https://pontualtech.com.br/#consulta-os" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>
              </tr></table>
              <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
              <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
                <td><a href="https://wa.me/{{company_whatsapp}}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
              </tr></table>
            </div>
          </td></tr>
          <!-- FOOTER -->
          <tr>
            <td style="background:#1e293b;padding:24px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">{{company_name}}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Assistencia Tecnica em Informatica</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Tel: {{company_phone}}</p>
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

/**
 * Busca configurações de lembrete de orçamento
 */
async function getQuoteReminderSettings(companyId: string) {
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'quote_reminder.' } },
  })
  const map: Record<string, string> = {}
  for (const s of settings) map[s.key] = s.value
  return {
    enabled: map['quote_reminder.enabled'] !== 'false',
    daysWaiting: parseInt(map['quote_reminder.days_waiting'] || '5', 10),
    intervalDays: parseInt(map['quote_reminder.interval_days'] || '3', 10),
    maxReminders: parseInt(map['quote_reminder.max_reminders'] || '3', 10),
  }
}

/**
 * Busca OS em status "Aguardando Aprovação" com email do cliente
 */
async function getOsAwaitingApproval(companyId: string, daysWaiting: number, intervalDays: number, maxReminders: number) {
  // Find statuses containing "Aprovacao" or "Aprovação" (case-insensitive via raw SQL)
  const approvalStatuses = await prisma.moduleStatus.findMany({
    where: {
      company_id: companyId,
      module: 'os',
    },
  })

  const matchingStatusIds = approvalStatuses
    .filter(s => {
      const normalized = s.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      return normalized.includes('aguardando aprovacao') || normalized.includes('aprovacao')
    })
    .map(s => s.id)

  if (matchingStatusIds.length === 0) return []

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysWaiting)

  // Find OS with these statuses
  const orders = await prisma.serviceOrder.findMany({
    where: {
      company_id: companyId,
      status_id: { in: matchingStatusIds },
      deleted_at: null,
      customers: { email: { not: null } },
    },
    include: {
      customers: true,
      companies: true,
      module_statuses: true,
      service_order_items: { where: { deleted_at: null } },
      service_order_history: {
        where: { to_status_id: { in: matchingStatusIds } },
        orderBy: { created_at: 'desc' },
        take: 1,
      },
    },
  })

  // Filter by history date (status set more than N days ago)
  const result = []
  for (const os of orders) {
    const historyEntry = os.service_order_history[0]
    if (!historyEntry?.created_at) continue

    const daysInStatus = daysSince(historyEntry.created_at)
    if (daysInStatus < daysWaiting) continue

    // Check reminder count and interval
    const reminders = await prisma.auditLog.findMany({
      where: {
        company_id: companyId,
        module: 'os',
        action: 'quote_reminder_sent',
        entity_id: os.id,
      },
      orderBy: { created_at: 'desc' },
    })

    if (reminders.length >= maxReminders) continue

    // Check interval since last reminder
    if (reminders.length > 0 && reminders[0].created_at) {
      const daysSinceLastReminder = daysSince(reminders[0].created_at)
      if (daysSinceLastReminder < intervalDays) continue
    }

    result.push({
      ...os,
      days_waiting: daysInStatus,
      reminders_sent: reminders.length,
      status_changed_at: historyEntry.created_at,
    })
  }

  return result
}

function buildItemsTableHtml(items: { description: string; quantity: number; unit_price: number; total_price: number; item_type: string }[]): string {
  if (items.length === 0) return ''

  let rows = ''
  for (const item of items) {
    const typeLabel = item.item_type === 'SERVICO' ? 'Serviço' : 'Peça'
    rows += `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${escapeHtml(item.description)}</td>
      <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9;font-size:13px;">${typeLabel}</td>
      <td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9;font-size:13px;">${item.quantity}</td>
      <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:13px;">${fmtCents(item.unit_price)}</td>
      <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">${fmtCents(item.total_price)}</td>
    </tr>`
  }

  return `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <thead>
      <tr style="background:#f8fafc;">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Descrição</th>
        <th style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Tipo</th>
        <th style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Qtd</th>
        <th style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Unit.</th>
        <th style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
}

/**
 * Lógica core de envio de lembretes — reutilizada pelo POST e pelo cron
 */
export async function sendQuoteReminders(companyId: string, userId: string, specificIds?: string[]) {
  const settings = await getQuoteReminderSettings(companyId)

  const msgTemplate = await prisma.messageTemplate.findFirst({
    where: { company_id: companyId, trigger: 'quote_approval_reminder', channel: 'email', is_active: true },
  })
  const htmlTemplate = msgTemplate?.template || DEFAULT_QUOTE_REMINDER_TEMPLATE

  const allSettings = await prisma.setting.findMany({ where: { company_id: companyId } })
  const settingsMap: Record<string, string> = {}
  for (const s of allSettings) settingsMap[s.key] = s.value

  const appUrl = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'

  let orders = await getOsAwaitingApproval(companyId, settings.daysWaiting, settings.intervalDays, settings.maxReminders)

  if (specificIds && specificIds.length > 0) {
    orders = orders.filter(os => specificIds.includes(os.id))
  }

  let sentCount = 0
  const errors: string[] = []

  for (const os of orders) {
    try {
      const customer = os.customers
      if (!customer?.email) continue

      const company = os.companies
      const token = generateOrcamentoToken(os.id)
      const approvalLink = `${appUrl}/portal/${company.slug}/orcamento/${os.id}?token=${token}`
      const rejectionLink = `${approvalLink}&action=reject`

      const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')
      const itemsTableHtml = buildItemsTableHtml(os.service_order_items)

      const whatsapp = (settingsMap['company.whatsapp'] || settingsMap['whatsapp'] || settingsMap['company.phone'] || '').replace(/\D/g, '')
      const accessTk = createAccessToken(os.customer_id, os.company_id)
      const portalOsLink = `${appUrl}/portal/${company.slug}/os/${os.id}?access=${accessTk}`

      const vars: Record<string, string> = {
        customer_name: escapeHtml(customer.legal_name || '—'),
        os_number: String(os.os_number),
        equipment: escapeHtml(equipment),
        diagnosis: escapeHtml(os.diagnosis || '—'),
        total_cost: fmtCents(os.total_cost || 0),
        days_waiting: String(os.days_waiting),
        approval_link: approvalLink,
        rejection_link: rejectionLink,
        portal_os_link: portalOsLink,
        company_name: escapeHtml(company.name || 'Empresa'),
        company_phone: escapeHtml(settingsMap['company.phone'] || settingsMap['telefone'] || '—'),
        company_whatsapp: whatsapp,
        items_table: itemsTableHtml,
      }

      const html = replaceTemplateVars(htmlTemplate, vars)
      const subject = `Orçamento Pendente - OS-${os.os_number} - ${company.name}`

      const sent = await sendCompanyEmail(companyId, customer.email, subject, html)

      if (sent) {
        sentCount++

        logAudit({
          companyId,
          userId,
          module: 'os',
          action: 'quote_reminder_sent',
          entityId: os.id,
          newValue: {
            to: customer.email,
            customer_name: customer.legal_name,
            os_number: os.os_number,
            total_cost: os.total_cost,
            days_waiting: os.days_waiting,
            reminders_sent: os.reminders_sent + 1,
          },
        })
      } else {
        errors.push(`Falha ao enviar para ${customer.email} (OS-${os.os_number})`)
      }
    } catch (err) {
      console.error(`[LembreteOrcamento] Erro ao processar OS ${os.id}:`, err)
      errors.push(`Erro interno ao processar OS-${os.os_number}`)
    }
  }

  return { sent: sentCount, total: orders.length, errors }
}

/**
 * GET - Lista OS aguardando aprovação de orçamento
 */
export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('os', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await getQuoteReminderSettings(user.companyId)
    const orders = await getOsAwaitingApproval(user.companyId, settings.daysWaiting, settings.intervalDays, settings.maxReminders)

    const items = orders.map(os => ({
      id: os.id,
      os_number: os.os_number,
      customer_name: os.customers?.legal_name || '—',
      customer_email: os.customers?.email || null,
      equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
      total_cost: os.total_cost || 0,
      days_waiting: os.days_waiting,
      reminders_sent: os.reminders_sent,
      status_name: os.module_statuses?.name || '—',
      status_changed_at: os.status_changed_at,
    }))

    return success({
      settings,
      orders: items,
      total: items.length,
      can_send: items.filter(i => i.customer_email).length,
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST - Enviar lembretes de orçamento por email
 */
export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json().catch(() => ({}))
    const { ids } = body as { ids?: string[] }

    const { sent, total, errors } = await sendQuoteReminders(
      user.companyId,
      user.id,
      ids && ids.length > 0 ? ids : undefined,
    )

    return success({ sent, total, errors })
  } catch (err) {
    return handleError(err)
  }
}
