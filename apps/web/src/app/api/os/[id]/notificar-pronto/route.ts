import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { sendCompanyEmail } from '@/lib/send-email'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { escapeHtml } from '@/lib/escape-html'
import { getCompanyContact } from '@/lib/company-contact'

type Params = { params: { id: string } }

/**
 * POST /api/os/[id]/notificar-pronto
 * Notifica o cliente que o equipamento está pronto para retirada/entrega
 * Body: { channels: ('email' | 'whatsapp')[] }
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: { customers: true, companies: true },
    })
    if (!os) return error('OS não encontrada', 404)

    const body = await req.json().catch(() => ({}))
    const channels: string[] = body.channels || ['email']

    // Carregar settings
    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    const cc = await getCompanyContact(user.companyId)

    const { toTitleCase } = await import('@/lib/format-text')
    const customerName = toTitleCase(os.customers?.legal_name || 'Cliente')
    const customerFirstName = customerName.split(' ')[0]
    const customerEmail = os.customers?.email || ''
    const customerPhone = os.customers?.mobile || os.customers?.phone || ''
    const osNum = String(os.os_number)
    const equipment = toTitleCase([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '))
    const companyName = os.companies?.name || cc.name
    const companyPhone = cc.phone
    const whatsappUrl = cc.whatsappUrl
    const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
    const portalSlug = os.companies?.slug || 'default'
    const portalUrl = `${portalBase}/portal/${portalSlug}/os/${os.id}`
    const osLocation = ((os as any).os_location || '').toUpperCase()
    const isLoja = osLocation === 'LOJA' || osLocation === 'BALCAO'

    const instrucaoRetirada = isLoja
      ? 'Voce pode retirar no nosso endereco.\nHorario de funcionamento: Seg a Sex, 09:00 as 17:00'
      : 'Passaremos as informacoes para nossa logistica, que entrara em contato para informar o dia da entrega.'

    // ===== WHATSAPP =====
    const whatsappMsg = `Ola ${customerFirstName}! Tudo bem?

Temos uma otima noticia! Seu equipamento ${equipment} (OS #${osNum}) esta pronto!

${instrucaoRetirada}

Acompanhe pelo portal: ${portalUrl}

Precisando de algo:
${companyPhone}
${whatsappUrl}

Obrigado pela confianca!
${companyName}

⚙️ Esta e uma mensagem automatica.`

    // ===== EMAIL =====
    // Load additional company data for footer
    const companyCnpj = cc.cnpj
    const companyEmail = cc.email
    const companyAddress = cc.address
    const companyWebsite = cc.website

    const emailHtml = `<!DOCTYPE html>
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
              <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;margin:0 auto 12px;line-height:56px;font-size:28px;">&#127881;</div>
              <h1 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:800;">Equipamento Pronto!</h1>
              <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;">${escapeHtml(companyName)}</p>
            </td>
          </tr>
          <!-- BODY -->
          <tr>
            <td style="padding:32px 32px 0;">
              <p style="font-size:16px;margin:0 0 16px;color:#1e293b;">Ola <strong>${escapeHtml(customerFirstName)}</strong>,</p>
              <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.7;">
                Temos uma otima noticia! O reparo do seu equipamento foi concluido com sucesso!
              </p>

              <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 24px;">
                <div style="padding:16px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;">
                    <tr><td style="padding:6px 0;font-weight:700;width:130px;color:#64748b;">Equipamento:</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(equipment)}</td></tr>
                    <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">OS:</td><td style="padding:6px 0;font-weight:600;">#${osNum}</td></tr>
                    <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Status:</td><td style="padding:6px 0;font-weight:800;color:#16a34a;">${isLoja ? 'Pronto para retirada' : 'Pronto — aguardando entrega'}</td></tr>
                  </table>
                </div>
              </div>

              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:0 0 24px;">
                <p style="margin:0 0 6px;font-size:11px;color:#3b82f6;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${isLoja ? 'COMO RETIRAR' : 'ENTREGA'}</p>
                <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.6;">
                  ${isLoja
                    ? `Voce pode retirar no nosso endereco.<br/><strong>Horario:</strong> Seg a Sex, 09:00 as 17:00`
                    : `Passaremos as informacoes para nossa <strong>logistica</strong>, que entrara em contato para informar o dia da entrega.`
                  }
                </p>
              </div>

              <div style="text-align:center;margin:0 0 16px;">
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#2563eb;border-radius:8px;">
                  <a href="${portalUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;">
                    Acompanhar minha OS
                  </a>
                </td></tr></table>
              </div>

              <div style="text-align:center;margin:0 0 32px;">
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#25d366;border-radius:8px;">
                  <a href="${whatsappUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;">
                    Fale com nosso suporte
                  </a>
                </td></tr></table>
              </div>
            </td>
          </tr>
          <!-- ACOMPANHE SUA OS -->
          <tr><td style="padding:0 32px 24px;">
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
              <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                <td style="padding:0 6px;"><a href="${`${portalBase}/portal/${portalSlug}`}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
                <td style="padding:0 6px;"><a href="${companyWebsite}/#consulta-os" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>
              </tr></table>
              <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
              <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
                <td><a href="${whatsappUrl}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
              </tr></table>
            </div>
          </td></tr>
          <!-- FOOTER -->
          <tr>
            <td style="background:#1e293b;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">${escapeHtml(companyName)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Assistencia Tecnica em Informatica</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${escapeHtml(companyAddress)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">CNPJ: ${escapeHtml(companyCnpj)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Tel: ${escapeHtml(companyPhone)} | ${escapeHtml(companyEmail)}</p>
              <p style="margin:0 0 10px;font-size:11px;color:#94a3b8;">${companyWebsite}</p>
              <div style="border-top:1px solid #334155;padding-top:10px;">
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

    const results: { channel: string; status: string }[] = []

    if (channels.includes('email') && customerEmail) {
      const sent = await sendCompanyEmail(user.companyId, customerEmail, `Equipamento Pronto — OS #${osNum} — ${companyName}`, emailHtml)
      results.push({ channel: 'email', status: sent ? 'enviado' : 'erro' })
    } else if (channels.includes('email') && !customerEmail) {
      results.push({ channel: 'email', status: 'sem_email' })
    }

    if (channels.includes('whatsapp') && customerPhone) {
      try {
        const phone = customerPhone.replace(/\D/g, '')
        const fallback = `*Equipamento pronto! — OS #${osNum}*\n\nSeu ${equipment || 'equipamento'} esta pronto para retirada!\n\nAcompanhe pelo portal do cliente.`
        const { createAccessToken } = await import('@/lib/portal-auth')
        const magicToken = createAccessToken(os.customer_id, user.companyId)
        const waResult = await sendWhatsAppTemplate(user.companyId, phone, 'pontualtech_pronto_v2', 'pt_BR', [
          { type: 'body', parameters: [
            { type: 'text', text: osNum },
            { type: 'text', text: equipment || 'Equipamento' },
          ] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: magicToken }] },
        ], fallback)
        results.push({ channel: 'whatsapp', status: waResult.success ? 'enviado' : 'erro' })
      } catch {
        results.push({ channel: 'whatsapp', status: 'erro' })
      }
    } else if (channels.includes('whatsapp') && !customerPhone) {
      results.push({ channel: 'whatsapp', status: 'sem_telefone' })
    }

    // Registrar nas obs internas
    const now = new Date()
    const dataHora = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const canaisEnviados = results.filter(r => r.status === 'enviado').map(r => r.channel).join(', ') || 'nenhum'
    const nota = `[${dataHora}] Notificacao "Equipamento Pronto" enviada via ${canaisEnviados}`
    await prisma.serviceOrder.update({
      where: { id: os.id },
      data: { internal_notes: os.internal_notes ? `${os.internal_notes}\n${nota}` : nota },
    })

    return success({ results })
  } catch (err) {
    return handleError(err)
  }
}
