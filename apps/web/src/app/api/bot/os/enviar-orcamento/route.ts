import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../../_lib/auth'
import { botSuccess, botError } from '../../_lib/response'
import { sendCompanyEmail } from '@/lib/send-email'
import { createAccessToken } from '@/lib/portal-auth'
import { escapeHtml } from '@/lib/escape-html'
import { rateLimit } from '@/lib/rate-limit'

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/**
 * POST /api/bot/os/enviar-orcamento
 *
 * Tool do Dify "enviar_link_orcamento" — reenvia email do orcamento
 * com link para o Portal do Cliente.
 * Multi-tenant: valida company_id via X-Bot-Key.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const body = await req.json().catch(() => ({}))
    const osNum = parseInt(body.numero_os, 10)

    if (!osNum || osNum < 1) return botError('numero_os e obrigatorio')

    // Only ERP OS (>= 60000) — legacy not supported
    if (osNum < 60000) {
      return botSuccess({
        sucesso: false,
        mensagem: 'Esta OS e do sistema legado. O orcamento deve ser solicitado diretamente ao atendente.',
      })
    }

    // Rate limit: max 5 per OS per hour
    const rl = rateLimit(`bot-orcamento:${osNum}`, 5, 60 * 60 * 1000)
    if (!rl.allowed) {
      return botSuccess({
        sucesso: false,
        mensagem: 'Orcamento ja foi enviado recentemente. Verifique seu email (inclusive spam/lixo eletronico).',
      })
    }

    // Load OS with items, customer, company
    const os = await prisma.serviceOrder.findFirst({
      where: { os_number: osNum, company_id: auth.companyId, deleted_at: null },
      include: {
        customers: true,
        companies: true,
        module_statuses: { select: { name: true } },
        service_order_items: {
          where: { deleted_at: null },
          select: { description: true, item_type: true, quantity: true, unit_price: true, total_price: true },
        },
      },
    })

    if (!os) return botSuccess({ sucesso: false, mensagem: `OS #${osNum} nao encontrada` })

    if (!os.customers?.email) {
      return botSuccess({
        sucesso: false,
        mensagem: 'Cliente nao possui email cadastrado. Informe seu email para que possamos enviar o orcamento.',
      })
    }

    if (os.service_order_items.length === 0 && (os.total_cost || 0) === 0) {
      return botSuccess({
        sucesso: false,
        mensagem: 'Esta OS ainda nao possui orcamento lancado. Assim que nossos tecnicos finalizarem a analise, enviaremos o orcamento.',
      })
    }

    // Build portal URL with magic token
    const company = os.companies
    const slug = company?.slug || 'pontualtech'
    const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
    const portalUrl = `${portalBase}/portal/${slug}/os/${os.id}`

    // Load company settings for email footer
    const settings = await prisma.setting.findMany({ where: { company_id: auth.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    const companyName = company?.name || cfg['company.name'] || 'Empresa'
    const companyPhone = cfg['company.phone'] || ''
    const companyEmail = cfg['company.email'] || ''
    const companyWebsite = cfg['company.website'] || ''
    const whatsappNum = (cfg['company.whatsapp'] || '').replace(/\D/g, '')
    const whatsappUrl = whatsappNum ? `https://wa.me/${whatsappNum}` : ''

    const customer = os.customers
    const customerName = customer.legal_name?.split(' ')[0] || 'Cliente'
    const osNumStr = String(os.os_number).padStart(4, '0')
    const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'Equipamento'

    // Build items table
    const servicos = os.service_order_items.filter(i => i.item_type !== 'PECA')
    const pecas = os.service_order_items.filter(i => i.item_type === 'PECA')

    const buildRows = (items: typeof servicos) => items.map(i => `
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${escapeHtml(i.description || '')}</td>
        <td style="padding:10px 16px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9;text-align:center;">${i.quantity}</td>
        <td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${fmtCents(i.total_price || 0)}</td>
      </tr>
    `).join('')

    const itemsHtml = `
      ${servicos.length > 0 ? `
        <div style="margin:0 0 16px;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.5px;">Servicos Tecnicos</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:8px 16px;font-size:11px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;">Descricao</td>
              <td style="padding:8px 16px;font-size:11px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:center;">Qtd</td>
              <td style="padding:8px 16px;font-size:11px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:right;">Valor</td>
            </tr>
            ${buildRows(servicos)}
          </table>
        </div>
      ` : ''}
      ${pecas.length > 0 ? `
        <div style="margin:0 0 16px;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:0.5px;">Pecas e Componentes</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <tr style="background:#f8fafc;">
              <td style="padding:8px 16px;font-size:11px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;">Descricao</td>
              <td style="padding:8px 16px;font-size:11px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:center;">Qtd</td>
              <td style="padding:8px 16px;font-size:11px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:right;">Valor</td>
            </tr>
            ${buildRows(pecas)}
          </table>
        </div>
      ` : ''}
    `

    const totalStr = fmtCents(os.total_cost || 0)

    // Build professional email
    const emailHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 50%,#3b82f6 100%);padding:32px;text-align:center;">
          <h1 style="margin:0 0 4px;color:#fff;font-size:20px;font-weight:800;">Orcamento — OS #${osNumStr}</h1>
          <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;">${escapeHtml(companyName)}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="font-size:16px;margin:0 0 16px;color:#1e293b;">Ola <strong>${escapeHtml(customerName)}</strong>,</p>
          <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6;">Segue o orcamento da sua OS <strong>#${osNumStr}</strong> (${escapeHtml(equipment)}):</p>

          ${itemsHtml}

          <div style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:10px;padding:20px;text-align:center;margin:0 0 24px;">
            <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.7);font-weight:600;text-transform:uppercase;">Valor Total</p>
            <p style="margin:0;font-size:28px;font-weight:800;color:#fff;">${totalStr}</p>
          </div>

          <div style="text-align:center;margin:0 0 16px;">
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
              <td style="background:#16a34a;border-radius:8px;">
                <a href="${portalUrl}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:16px 40px;">Aprovar Orcamento</a>
              </td>
            </tr></table>
            <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Voce pode aprovar ou recusar direto pelo Portal</p>
          </div>

          ${whatsappUrl ? `
          <div style="text-align:center;margin:0 0 24px;">
            <a href="${whatsappUrl}" style="display:inline-block;background:#25d366;color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 24px;border-radius:8px;">Falar com Suporte</a>
          </div>
          ` : ''}
        </td></tr>
        <tr><td style="background:#1e293b;padding:24px 32px;text-align:center;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">${escapeHtml(companyName)}</p>
          ${companyPhone ? `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Tel: ${escapeHtml(companyPhone)}</p>` : ''}
          ${companyEmail ? `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${escapeHtml(companyEmail)}</p>` : ''}
          <div style="border-top:1px solid #334155;padding-top:10px;margin-top:10px;">
            <p style="margin:0;font-size:10px;color:#64748b;">Mensagem automatica. Nao responda este email.</p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

    // Send email
    const sent = await sendCompanyEmail(
      auth.companyId,
      customer.email!,
      `Orcamento OS #${osNumStr} — ${companyName}`,
      emailHtml,
    )

    if (!sent) {
      return botSuccess({
        sucesso: false,
        mensagem: 'Houve uma falha ao enviar o email. Nossa equipe sera notificada para enviar manualmente.',
      })
    }

    // Log in history
    await prisma.serviceOrderHistory.create({
      data: {
        company_id: auth.companyId,
        service_order_id: os.id,
        to_status_id: os.status_id,
        changed_by: 'BOT_MARTA',
        notes: `Orcamento reenviado para ${customer.email} via Bot Marta`,
      },
    }).catch(() => {})

    return botSuccess({
      sucesso: true,
      mensagem: `Orcamento enviado para ${customer.email}`,
      link_portal: portalUrl,
      valor_total: totalStr,
    })
  } catch (err: any) {
    console.error('[Bot os/enviar-orcamento]', err.message)
    return botError('Erro interno ao enviar orcamento', 500)
  }
}
