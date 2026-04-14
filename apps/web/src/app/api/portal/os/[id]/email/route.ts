import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { sendCompanyEmail } from '@/lib/send-email'
import { escapeHtml } from '@/lib/escape-html'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { email } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Email invalido' }, { status: 400 })
    }

    // Load OS with related data
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        module_statuses: {
          select: { name: true, color: true },
        },
        customers: {
          select: { legal_name: true, email: true, phone: true, mobile: true },
        },
        companies: {
          select: { name: true, slug: true },
        },
        service_order_items: {
          where: { deleted_at: null },
          select: {
            item_type: true,
            description: true,
            quantity: true,
            unit_price: true,
            total_price: true,
          },
        },
      },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    const fmt = (v: number) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v / 100)

    const statusName = os.module_statuses?.name || 'Em andamento'
    const statusColor = os.module_statuses?.color || '#3B82F6'
    const companyName = os.companies?.name || 'Empresa'
    const companySlug = os.companies?.slug || ''
    const customerName = os.customers?.legal_name || 'Cliente'
    const portalUrl = `${process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'}/portal/${companySlug}/os/${os.id}`

    // Build items table rows
    const itemsRows = os.service_order_items
      .map(
        (item) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; background: ${item.item_type === 'PECA' ? '#DBEAFE' : '#EDE9FE'}; color: ${item.item_type === 'PECA' ? '#1D4ED8' : '#7C3AED'};">
              ${item.item_type === 'PECA' ? 'Peca' : 'Servico'}
            </span>
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #111827;">${escapeHtml(item.description)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; text-align: center;">${item.quantity}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #6b7280; text-align: right;">${fmt(item.unit_price)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #111827; font-weight: 500; text-align: right;">${fmt(item.total_price)}</td>
        </tr>`
      )
      .join('')

    const itemsTable =
      os.service_order_items.length > 0
        ? `
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <thead>
          <tr style="background: #f9fafb;">
            <th style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;">Tipo</th>
            <th style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;">Descricao</th>
            <th style="padding: 8px 12px; text-align: center; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;">Qtd</th>
            <th style="padding: 8px 12px; text-align: right; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;">Unit.</th>
            <th style="padding: 8px 12px; text-align: right; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;">Total</th>
          </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
        <tfoot>
          <tr style="background: #f9fafb;">
            <td colspan="4" style="padding: 10px 12px; text-align: right; font-weight: 600; color: #374151; font-size: 14px; border-top: 2px solid #e5e7eb;">Total</td>
            <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: #111827; font-size: 16px; border-top: 2px solid #e5e7eb;">${fmt(os.total_cost || 0)}</td>
          </tr>
        </tfoot>
      </table>`
        : ''

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px;">
    <!-- Header -->
    <div style="background: #1e40af; border-radius: 12px 12px 0 0; padding: 24px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 20px;">${escapeHtml(companyName)}</h1>
      <p style="color: #bfdbfe; margin: 8px 0 0; font-size: 14px;">Ordem de Servico</p>
    </div>

    <!-- Body -->
    <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px;">
      <p style="color: #374151; font-size: 14px; margin: 0 0 16px;">Ola, <strong>${escapeHtml(customerName)}</strong>!</p>
      <p style="color: #6b7280; font-size: 14px; margin: 0 0 24px;">Segue o resumo da sua Ordem de Servico:</p>

      <!-- OS Info -->
      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; font-size: 14px; color: #6b7280;">Numero</td>
            <td style="padding: 4px 0; font-size: 14px; color: #111827; font-weight: 600; text-align: right;">OS #${os.os_number}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; font-size: 14px; color: #6b7280;">Data de Abertura</td>
            <td style="padding: 4px 0; font-size: 14px; color: #111827; text-align: right;">${new Date(os.created_at || Date.now()).toLocaleDateString('pt-BR')}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; font-size: 14px; color: #6b7280;">Status</td>
            <td style="padding: 4px 0; text-align: right;">
              <span style="display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; background: ${statusColor}20; color: ${statusColor};">${escapeHtml(statusName)}</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Equipment -->
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin: 0 0 8px;">Equipamento</h3>
        <p style="font-size: 14px; color: #111827; margin: 0; font-weight: 500;">${escapeHtml(os.equipment_type)}${os.equipment_brand ? ` - ${escapeHtml(os.equipment_brand)}` : ''}${os.equipment_model ? ` ${escapeHtml(os.equipment_model)}` : ''}</p>
        ${os.serial_number ? `<p style="font-size: 13px; color: #6b7280; margin: 4px 0 0;">S/N: ${escapeHtml(os.serial_number)}</p>` : ''}
      </div>

      <!-- Diagnosis -->
      ${os.diagnosis ? `
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin: 0 0 8px;">Diagnostico / Laudo</h3>
        <p style="font-size: 14px; color: #374151; margin: 0; white-space: pre-wrap;">${escapeHtml(os.diagnosis)}</p>
      </div>` : ''}

      <!-- Items -->
      ${itemsTable}

      <!-- Total -->
      ${os.total_cost ? `
      <div style="background: #eff6ff; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
        <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px; text-transform: uppercase; font-weight: 600;">Valor Total</p>
        <p style="font-size: 24px; color: #1e40af; margin: 0; font-weight: 700;">${fmt(os.total_cost)}</p>
      </div>` : ''}

      <!-- CTA -->
      <div style="text-align: center; margin: 24px 0 0;">
        <a href="${portalUrl}" style="display: inline-block; padding: 12px 32px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
          Acessar Portal
        </a>
        <p style="font-size: 12px; color: #9ca3af; margin: 12px 0 0;">Acompanhe o andamento da sua OS em tempo real</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 16px; font-size: 12px; color: #9ca3af;">
      Enviado por ${escapeHtml(companyName)} via PontualERP
    </div>
  </div>
</body>
</html>`

    const subject = `OS #${os.os_number} - ${companyName}`
    const sent = await sendCompanyEmail(portalUser.company_id, email, subject, html)

    if (!sent) {
      return NextResponse.json({ error: 'Falha ao enviar email' }, { status: 500 })
    }

    return NextResponse.json({ data: { success: true, message: 'Email enviado com sucesso' } })
  } catch (err) {
    console.error('[Portal OS Email Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
