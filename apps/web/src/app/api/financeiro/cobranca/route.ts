import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendEmail } from '@/lib/send-email'
import { createHmac } from 'crypto'

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(date: Date | string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('pt-BR')
}

function daysOverdue(dueDate: Date): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)))
}

function generatePaymentToken(receivableId: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY nao configurada')
  return createHmac('sha256', key).update(receivableId).digest('hex').slice(0, 16)
}

function replaceTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '—')
  }
  return result
}

const DEFAULT_PAYMENT_REMINDER_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
<div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
  <div style="background:#1e40af;padding:24px;text-align:center;">
    <h2 style="margin:0;color:#fff;font-size:20px;">{{company_name}}</h2>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 16px;font-size:15px;color:#1e293b;">
      Prezado(a) <strong>{{customer_name}}</strong>,
    </p>
    <p style="margin:0 0 20px;color:#475569;">
      Informamos que existe um valor pendente em seu cadastro. Segue o detalhamento abaixo:
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Descrição</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Valor</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Vencimento</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Dias em atraso</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">{{description}}</td>
          <td style="padding:10px 12px;text-align:right;font-weight:600;color:#dc2626;border-bottom:1px solid #f1f5f9;">{{amount}}</td>
          <td style="padding:10px 12px;text-align:center;border-bottom:1px solid #f1f5f9;">{{due_date}}</td>
          <td style="padding:10px 12px;text-align:center;font-weight:600;color:#dc2626;border-bottom:1px solid #f1f5f9;">{{days_overdue}} dias</td>
        </tr>
      </tbody>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{payment_link}}" style="display:inline-block;background:#16a34a;color:#fff;font-size:16px;font-weight:600;padding:14px 40px;border-radius:8px;text-decoration:none;">
        Pagar Agora
      </a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
      Caso já tenha efetuado o pagamento, por favor desconsidere esta mensagem.
    </p>
  </div>
  <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">
      {{company_name}} | Tel: {{company_phone}}<br>
      Em caso de dúvidas, entre em contato conosco.
    </p>
  </div>
</div>
</body>
</html>`

/**
 * Busca as configurações de cobrança da empresa
 */
async function getCobrancaSettings(companyId: string) {
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'cobranca.' } },
  })
  const map: Record<string, string> = {}
  for (const s of settings) map[s.key] = s.value
  return {
    enabled: map['cobranca.enabled'] !== 'false',
    intervalDays: parseInt(map['cobranca.interval_days'] || '7', 10),
    minDaysOverdue: parseInt(map['cobranca.min_days_overdue'] || '3', 10),
  }
}

/**
 * Busca recebiveis vencidos com email do cliente
 */
async function getOverdueReceivables(companyId: string, minDaysOverdue: number, specificIds?: string[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const minDueDate = new Date(today)
  minDueDate.setDate(minDueDate.getDate() - minDaysOverdue)

  const where: any = {
    company_id: companyId,
    status: 'PENDENTE',
    due_date: { lt: minDueDate },
    deleted_at: null,
    customers: { email: { not: null } },
  }

  if (specificIds && specificIds.length > 0) {
    where.id = { in: specificIds }
  }

  return prisma.accountReceivable.findMany({
    where,
    include: {
      customers: true,
      companies: true,
    },
    orderBy: { due_date: 'asc' },
  })
}

/**
 * Verifica se a cobrança já foi enviada hoje para este recebível
 */
async function wasRemindedToday(companyId: string, receivableId: string): Promise<boolean> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const log = await prisma.auditLog.findFirst({
    where: {
      company_id: companyId,
      module: 'cobranca',
      action: 'reminder_sent',
      entity_id: receivableId,
      created_at: { gte: todayStart },
    },
  })
  return !!log
}

/**
 * Lógica core de envio de cobranças — reutilizada pelo POST e pelo cron
 */
export async function sendOverdueReminders(companyId: string, userId: string, specificIds?: string[]) {
  const cobrancaSettings = await getCobrancaSettings(companyId)

  // Carregar template de email
  const msgTemplate = await prisma.messageTemplate.findFirst({
    where: { company_id: companyId, trigger: 'payment_reminder', channel: 'email', is_active: true },
  })
  const htmlTemplate = msgTemplate?.template || DEFAULT_PAYMENT_REMINDER_TEMPLATE

  // Carregar settings da empresa
  const allSettings = await prisma.setting.findMany({ where: { company_id: companyId } })
  const settingsMap: Record<string, string> = {}
  for (const s of allSettings) settingsMap[s.key] = s.value

  const receivables = await getOverdueReceivables(companyId, cobrancaSettings.minDaysOverdue, specificIds)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://erp.pontualtech.work'
  let sentCount = 0
  const errors: string[] = []

  for (const rec of receivables) {
    try {
      // Pular se já lembrado hoje
      if (await wasRemindedToday(companyId, rec.id)) continue

      const customer = rec.customers
      if (!customer?.email) continue

      const company = rec.companies
      const token = generatePaymentToken(rec.id)
      const paymentLink = `${appUrl}/portal/${company.slug}/pagamento/${rec.id}?token=${token}`

      const days = daysOverdue(rec.due_date)
      const pendingAmount = rec.total_amount - (rec.received_amount || 0)

      const vars: Record<string, string> = {
        customer_name: customer.legal_name || '—',
        amount: fmtCents(pendingAmount),
        due_date: fmtDate(rec.due_date),
        days_overdue: String(days),
        payment_link: paymentLink,
        company_name: company.name || 'Empresa',
        company_phone: settingsMap['company.phone'] || settingsMap['telefone'] || '—',
        description: rec.description || '—',
      }

      const html = replaceTemplateVars(htmlTemplate, vars)
      const subject = `Lembrete de Pagamento - ${company.name}`

      const sent = await sendEmail(customer.email, subject, html)

      if (sent) {
        sentCount++

        logAudit({
          companyId,
          userId,
          module: 'cobranca',
          action: 'reminder_sent',
          entityId: rec.id,
          newValue: {
            to: customer.email,
            customer_name: customer.legal_name,
            amount: pendingAmount,
            days_overdue: days,
          },
        })

        // Atualizar notas do recebível
        const today = new Date().toLocaleDateString('pt-BR')
        const currentNotes = rec.notes || ''
        const newNote = `Cobrança enviada em ${today}`
        await prisma.accountReceivable.update({
          where: { id: rec.id },
          data: { notes: currentNotes ? `${currentNotes}\n${newNote}` : newNote },
        })
      } else {
        errors.push(`Falha ao enviar para ${customer.email} (${customer.legal_name})`)
      }
    } catch (err) {
      console.error(`[Cobranca] Erro ao processar recebível ${rec.id}:`, err)
      errors.push(`Erro interno ao processar ${rec.id}`)
    }
  }

  return { sent: sentCount, total: receivables.length, errors }
}

/**
 * GET - Listar recebíveis vencidos com info de email (preview)
 */
export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cobrancaSettings = await getCobrancaSettings(user.companyId)
    const receivables = await getOverdueReceivables(user.companyId, cobrancaSettings.minDaysOverdue)

    const items = await Promise.all(
      receivables.map(async (rec) => {
        const reminded = await wasRemindedToday(user.companyId, rec.id)
        const days = daysOverdue(rec.due_date)
        const pendingAmount = rec.total_amount - (rec.received_amount || 0)
        return {
          id: rec.id,
          description: rec.description,
          customer_name: rec.customers?.legal_name || '—',
          customer_email: rec.customers?.email || null,
          total_amount: rec.total_amount,
          pending_amount: pendingAmount,
          due_date: rec.due_date,
          days_overdue: days,
          reminded_today: reminded,
          payment_method: rec.payment_method,
        }
      })
    )

    return success({
      settings: cobrancaSettings,
      receivables: items,
      total: items.length,
      can_send: items.filter(i => !i.reminded_today && i.customer_email).length,
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST - Enviar cobranças por email
 */
export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json().catch(() => ({}))
    const { ids } = body as { ids?: string[] }

    const { sent, total, errors } = await sendOverdueReminders(
      user.companyId,
      user.id,
      ids && ids.length > 0 ? ids : undefined,
    )

    return success({ sent, total, errors })
  } catch (err) {
    return handleError(err)
  }
}
