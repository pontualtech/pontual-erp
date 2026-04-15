import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendCompanyEmail } from '@/lib/send-email'
import { sendWhatsAppCloud, sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { rateLimit } from '@/lib/rate-limit'
import { escapeHtml } from '@/lib/escape-html'

type Params = { params: { id: string } }

/**
 * POST /api/os/[id]/notificar-abertura
 * Envia email ao cliente informando que a OS foi aberta + link do portal.
 * Pode ser chamado internamente (sem auth) ou via Bot Ana.
 *
 * Body opcional: { companyId?: string }
 * Se não tiver auth (webhook/bot), usa companyId do body ou default.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    // Validate internal secret — prevents external abuse
    const internalKey = req.headers.get('x-internal-key') || ''
    const expectedKey = process.env.INTERNAL_API_KEY || process.env.BOT_ANA_API_KEY || ''
    if (!expectedKey || !internalKey || internalKey.length !== expectedKey.length || !timingSafeEqual(Buffer.from(internalKey), Buffer.from(expectedKey))) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    // Rate limit: max 3 notifications per OS per hour (prevents spam)
    const rl = rateLimit(`notif-abertura:${params.id}`, 3, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Notificação já enviada recentemente' }, { status: 429 })
    }

    const body = await req.json().catch(() => ({}))

    // Extract companyId from body (bot/webhook context)
    const companyId = body.companyId || body.company_id
    if (!companyId) {
      return NextResponse.json({ error: 'companyId obrigatório' }, { status: 400 })
    }

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: companyId, deleted_at: null },
      include: {
        customers: true,
        companies: true,
        module_statuses: { select: { name: true, color: true } },
      },
    })
    if (!os) return error('OS não encontrada', 404)

    const customer = os.customers
    if (!customer?.email) return error('Cliente sem email cadastrado', 400)

    const company = os.companies
    const companySettings = (company?.settings || {}) as Record<string, string>
    // Load company settings from DB for dynamic data
    const dbSettings = await prisma.setting.findMany({ where: { company_id: companyId } }).catch(() => [])
    const cfg: Record<string, string> = {}
    for (const s of dbSettings) cfg[s.key] = s.value

    const companyName = company?.name || cfg['company.name'] || 'Empresa'
    const companyPhone = cfg['company.phone'] || companySettings['phone'] || ''
    const companyWhatsApp = (cfg['company.whatsapp'] || '').replace(/\D/g, '')
    const companyEmail = cfg['company.email'] || companySettings['email'] || ''
    const companyWebsite = cfg['company.website'] || ''
    const slug = company?.slug || 'pontualtech'
    const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
    const portalUrl = `${portalBase}/portal/${slug}`
    const osDetailUrl = `${portalUrl}/os/${os.id}`
    const osNum = String(os.os_number).padStart(4, '0')
    const customerName = customer.legal_name?.split(' ')[0] || 'Cliente'
    const fullName = customer.legal_name || 'Cliente'
    const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')
    const dt = os.created_at ? new Date(os.created_at) : new Date()
    const createdDate = dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const createdTime = dt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#ffffff">

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);padding:30px 24px;text-align:center">
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700">${escapeHtml(companyName)}</h1>
    <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px">Assistencia Tecnica em Informatica</p>
  </div>

  <!-- BODY -->
  <div style="padding:32px 24px">

    <!-- Greeting -->
    <p style="font-size:16px;color:#1e293b;margin:0 0 8px">
      Ola <strong>${escapeHtml(customerName)}</strong>! 👋
    </p>
    <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 24px">
      Sua ordem de servico foi registrada com sucesso. Abaixo estao os detalhes:
    </p>

    <!-- OS CARD -->
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:20px;margin:0 0 24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 16px">
        <div>
          <p style="font-size:12px;color:#64748b;margin:0;text-transform:uppercase;font-weight:600">Ordem de Servico</p>
          <p style="font-size:28px;color:#1e40af;margin:4px 0 0;font-weight:800;font-family:monospace">OS-${osNum}</p>
        </div>
        <div style="background:${os.module_statuses?.color || '#3b82f6'}22;color:${os.module_statuses?.color || '#3b82f6'};padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600">
          ${escapeHtml(os.module_statuses?.name || 'Aberta')}
        </div>
      </div>

      <table style="width:100%;font-size:13px;color:#334155;border-collapse:collapse">
        <tr>
          <td style="padding:6px 0;color:#64748b;width:120px">Cliente</td>
          <td style="padding:6px 0;font-weight:500">${escapeHtml(fullName)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Equipamento</td>
          <td style="padding:6px 0;font-weight:500">${escapeHtml(equipment) || 'Impressora'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Defeito</td>
          <td style="padding:6px 0;font-weight:500">${escapeHtml(os.reported_issue) || 'A diagnosticar'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Data</td>
          <td style="padding:6px 0;font-weight:500">${createdDate} as ${createdTime}</td>
        </tr>
        ${os.equipment_brand ? `<tr><td style="padding:6px 0;color:#64748b">Marca/Modelo</td><td style="padding:6px 0;font-weight:500">${escapeHtml(os.equipment_brand)} ${escapeHtml(os.equipment_model || '')}</td></tr>` : ''}
      </table>
    </div>

    <!-- COLETA -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;margin:0 0 24px">
      <p style="font-size:15px;font-weight:700;color:#1e40af;margin:0 0 12px">🚚 Coleta agendada para o proximo dia util!</p>
      <table style="font-size:13px;color:#334155;border-collapse:collapse;width:100%">
        <tr><td style="padding:6px 0;line-height:1.6">Nossa equipe de <strong>logistica</strong> entrara em contato por <strong>telefone, WhatsApp ou e-mail</strong> para confirmar o endereco e horario da coleta.</td></tr>
      </table>
      <div style="background:#dbeafe;border-radius:8px;padding:12px;margin:12px 0 0">
        <p style="font-size:12px;color:#1e40af;margin:0;line-height:1.6"><strong>📦 Orientacoes para envio:</strong><br>
        • Cabos e fonte de energia <strong>nao precisam ser enviados</strong><br>
        • Mantenha os <strong>cartuchos ou toner na maquina</strong> para testes finais<br>
        • Horario de coleta: <strong>Seg a Sex, 09h as 17h</strong></p>
      </div>
    </div>

    <!-- PRÓXIMOS PASSOS -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:0 0 24px">
      <p style="font-size:14px;font-weight:700;color:#166534;margin:0 0 12px">📋 Proximos passos:</p>
      <table style="font-size:13px;color:#334155;border-collapse:collapse;width:100%">
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top">1️⃣</td><td style="padding:4px 0"><strong>Coleta:</strong> Nossa logistica busca seu equipamento no proximo dia util</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top">2️⃣</td><td style="padding:4px 0"><strong>Diagnostico:</strong> Nossos tecnicos analisam e enviam o orcamento</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top">3️⃣</td><td style="padding:4px 0"><strong>Aprovacao:</strong> Voce aprova pelo Portal ou WhatsApp</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top">4️⃣</td><td style="padding:4px 0"><strong>Reparo e Entrega:</strong> Consertamos e devolvemos com garantia</td></tr>
      </table>
    </div>

    <!-- PORTAL CTA -->
    <div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:12px;padding:24px;margin:0 0 24px;text-align:center">
      <p style="font-size:15px;font-weight:700;color:#1e40af;margin:0 0 8px">🖥️ Acompanhe online pelo Portal do Cliente</p>
      <p style="font-size:13px;color:#475569;margin:0 0 16px">
        Consulte o status da sua OS, aprove orcamentos e veja o historico completo a qualquer momento.
      </p>
      <a href="${osDetailUrl}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:0.5px">
        ACESSAR MINHA OS
      </a>
      <p style="font-size:11px;color:#94a3b8;margin:12px 0 0">
        Primeiro acesso? <a href="${portalUrl}/registrar" style="color:#3b82f6;text-decoration:underline">Crie sua senha aqui</a>
      </p>
    </div>

    <!-- INSTRUÇÕES PORTAL -->
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:16px;margin:0 0 24px">
      <p style="font-size:13px;font-weight:600;color:#854d0e;margin:0 0 8px">💡 Como acessar o Portal do Cliente:</p>
      <ol style="font-size:12px;color:#713f12;margin:0;padding-left:18px;line-height:1.8">
        <li>Acesse <a href="${portalUrl}" style="color:#1e40af;font-weight:600">${slug === 'pontualtech' ? 'portal.pontualtech.com.br' : `portal.${slug}.com.br`}</a></li>
        <li>Login: seu <strong>CPF ou CNPJ</strong></li>
        <li>Senha: <strong>os 5 primeiros digitos</strong> do seu CPF/CNPJ</li>
        <li>Pronto! Acompanhe suas OS, aprove orcamentos e mais</li>
      </ol>
    </div>

    <!-- CONTATO -->
    <div style="border-top:1px solid #e2e8f0;padding-top:20px;margin-top:8px;text-align:center">
      <p style="font-size:13px;color:#475569;margin:0 0 12px">
        Duvidas? Fale com a gente pelo WhatsApp!
      </p>
      <a href="https://wa.me/${companyWhatsApp}" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:700;font-size:14px">
        💬 Chamar no WhatsApp
      </a>
      <p style="font-size:12px;color:#94a3b8;margin:10px 0 0">
        ✉️ <a href="mailto:${companyEmail}" style="color:#64748b;text-decoration:none">${companyEmail}</a>
      </p>
    </div>
  </div>

  <!-- ACOMPANHE SUA OS -->
  <div style="padding:0 24px 24px;">
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
      <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="padding:0 6px;"><a href="${portalUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
        ${companyWebsite ? `<td style="padding:0 6px;"><a href="${companyWebsite}/#consulta-os" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>` : ''}
      </tr></table>
      <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
      <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
        <td><a href="https://wa.me/${companyWhatsApp}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
      </tr></table>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#1e293b;padding:20px 24px;text-align:center">
    <p style="color:#94a3b8;font-size:12px;margin:0 0 4px">${escapeHtml(companyName)}</p>
    <p style="color:#64748b;font-size:11px;margin:0">
      ${escapeHtml(companySettings['address'] || companySettings['endereco'] || 'Sao Paulo — SP')}
    </p>
    ${companySettings['cnpj'] ? `<p style="color:#64748b;font-size:11px;margin:4px 0 0">CNPJ: ${escapeHtml(companySettings['cnpj'])}</p>` : ''}
    <p style="color:#475569;font-size:10px;margin:12px 0 0">
      Este email foi enviado automaticamente. Nao responda diretamente.
    </p>
  </div>

</div>
</body>
</html>`

    const subject = `OS-${osNum} aberta — ${equipment || 'Seu equipamento'} | ${companyName}`

    // Send email
    let emailSent = false
    try {
      await sendCompanyEmail(os.company_id, customer.email, subject, html)
      emailSent = true
    } catch (emailErr: any) {
      console.error('[notificar-abertura] Email falhou:', emailErr.message)
    }

    // Send WhatsApp (fire-and-forget)
    let whatsappSent = false
    const phone = customer.mobile || customer.phone
    if (phone) {
      const fallback = `*OS #${osNum} aberta!*\n\nEquipamento: ${equipment || 'Equipamento'}\nProblema: ${os.reported_issue || 'A diagnosticar'}\n\nAcompanhe pelo portal do cliente.`
      const result = await sendWhatsAppTemplate(companyId, phone, 'pt_os_aberta_v2', 'pt_BR', [
        { type: 'body', parameters: [
          { type: 'text', text: osNum },
          { type: 'text', text: equipment || 'Equipamento' },
          { type: 'text', text: os.reported_issue || 'A diagnosticar' },
        ] }
      ], fallback)
      whatsappSent = result.success
    }

    // Update internal notes
    const notifications = []
    if (emailSent) notifications.push(`EMAIL para ${customer.email}`)
    if (whatsappSent) notifications.push(`WHATSAPP para ${phone}`)
    if (notifications.length > 0) {
      await prisma.serviceOrder.update({
        where: { id: os.id },
        data: {
          internal_notes: (os.internal_notes || '') + `\nNOTIFICAÇÃO ABERTURA: ${notifications.join(' + ')} em ${createdDate} ${createdTime}`,
        },
      })
    }

    return success({ sent: true, email: emailSent ? customer.email : null, whatsapp: whatsappSent ? phone : null, subject })
  } catch (err: any) {
    console.error('[notificar-abertura]', err.message)
    return handleError(err)
  }
}
