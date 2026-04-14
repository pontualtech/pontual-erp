import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { sendCompanyEmail } from '@/lib/send-email'

/**
 * POST /api/os/bulk-notify
 *
 * Sends notifications (email and/or WhatsApp) to customers of selected OS.
 * Uses the notification rule configured for the OS's current status.
 *
 * Body: { ids: string[], channels: { email?: boolean, whatsapp?: boolean }, customMessage?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const { ids, channels, customMessage } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) return error('ids é obrigatório', 400)
    if (ids.length > 100) return error('Máximo 100 OS por vez', 400)
    if (!channels?.email && !channels?.whatsapp) return error('Selecione pelo menos um canal (email ou whatsapp)', 400)

    const osList = await prisma.serviceOrder.findMany({
      where: { id: { in: ids }, company_id: user.companyId, deleted_at: null },
      include: {
        customers: { select: { id: true, legal_name: true, email: true, phone: true, mobile: true } },
        module_statuses: { select: { id: true, name: true } },
      },
    })

    if (osList.length === 0) return error('Nenhuma OS encontrada', 404)

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true, slug: true },
    })

    const portalUrl = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

    const results: { id: string; os_number: number; customer: string; email_sent: boolean; whatsapp_sent: boolean; error?: string }[] = []

    for (const os of osList) {
      const entry = {
        id: os.id,
        os_number: os.os_number,
        customer: os.customers?.legal_name || 'Sem cliente',
        email_sent: false,
        whatsapp_sent: false,
        error: undefined as string | undefined,
      }

      if (!os.customers) {
        entry.error = 'OS sem cliente vinculado'
        results.push(entry)
        continue
      }

      const osNum = String(os.os_number).padStart(4, '0')
      const statusName = os.module_statuses?.name || 'Atualizado'
      const customerName = os.customers.legal_name || 'Cliente'

      // Load notification rule for this OS's status
      let notifRule = { email_subject: '', email_message: '', whatsapp_message: '' }
      if (os.module_statuses?.id) {
        const setting = await prisma.setting.findUnique({
          where: { company_id_key: { company_id: user.companyId, key: `notif.rule.${os.module_statuses.id}` } },
        }).catch(() => null)
        if (setting?.value) {
          try { notifRule = { ...notifRule, ...JSON.parse(setting.value) } } catch {}
        }
      }

      // Build messages
      const defaultWhatsApp = `Olá ${customerName}! Sua OS-${osNum} está no status: *${statusName}*.\n\nAcompanhe pelo portal: ${portalUrl}/portal/${company?.slug || 'pontualtech'}/login`
      const whatsappMsg = customMessage || notifRule.whatsapp_message
        ?.replace(/\{\{cliente_nome\}\}/g, customerName)
        .replace(/\{\{os_numero\}\}/g, osNum)
        .replace(/\{\{status\}\}/g, statusName)
        .replace(/\{\{empresa\}\}/g, company?.name || '')
        .replace(/\{\{portal_url\}\}/g, `${portalUrl}/portal/${company?.slug || 'pontualtech'}/login`)
        || defaultWhatsApp

      const defaultSubject = `${company?.name || 'ERP'} — OS-${osNum} — ${statusName}`
      const emailSubject = notifRule.email_subject
        ?.replace(/\{\{os_numero\}\}/g, osNum)
        .replace(/\{\{status\}\}/g, statusName)
        .replace(/\{\{empresa\}\}/g, company?.name || '')
        || defaultSubject

      const defaultEmailBody = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#1e40af">OS-${osNum} — ${statusName}</h2>
          <p>Olá <strong>${customerName}</strong>,</p>
          <p>Sua Ordem de Serviço <strong>OS-${osNum}</strong> está no status: <strong>${statusName}</strong>.</p>
          <p>Acompanhe pelo portal:</p>
          <p><a href="${portalUrl}/portal/${company?.slug || 'pontualtech'}/login" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px">Acessar Portal</a></p>
          <p style="color:#6b7280;font-size:12px;margin-top:20px">— ${company?.name || 'ERP'}</p>
        </div>`

      const emailBody = notifRule.email_message
        ?.replace(/\{\{cliente_nome\}\}/g, customerName)
        .replace(/\{\{os_numero\}\}/g, osNum)
        .replace(/\{\{status\}\}/g, statusName)
        .replace(/\{\{empresa\}\}/g, company?.name || '')
        .replace(/\{\{portal_url\}\}/g, `${portalUrl}/portal/${company?.slug || 'pontualtech'}/login`)
        || defaultEmailBody

      // Send WhatsApp
      if (channels.whatsapp) {
        const phone = os.customers.mobile || os.customers.phone
        if (phone) {
          try {
            const res = await fetch(`${appUrl}/api/integracoes/chatwoot/enviar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone, message: whatsappMsg }),
              signal: AbortSignal.timeout(10000),
            })
            entry.whatsapp_sent = res.ok
          } catch {
            entry.whatsapp_sent = false
          }
        }
      }

      // Send Email
      if (channels.email) {
        if (os.customers.email) {
          try {
            await sendCompanyEmail(user.companyId, os.customers.email, emailSubject, emailBody)
            entry.email_sent = true
          } catch {
            entry.email_sent = false
          }
        }
      }

      results.push(entry)
    }

    const emailOk = results.filter(r => r.email_sent).length
    const whatsappOk = results.filter(r => r.whatsapp_sent).length
    const errors = results.filter(r => r.error).length

    return success({ results, emailOk, whatsappOk, errors, total: results.length })
  } catch (err) {
    return handleError(err)
  }
}
