import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendEmail } from '@/lib/send-email'

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
    // Aceita chamada interna (sem auth) — usado pelo bot e webhooks
    const body = await req.json().catch(() => ({}))

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, deleted_at: null },
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
    const companyName = company?.name || 'PontualTech'
    const companyPhone = companySettings['phone'] || companySettings['telefone'] || '(11) 2626-3841'
    const companyWhatsApp = '551126263841'
    const companyEmail = companySettings['email'] || 'contato@pontualtech.com.br'
    const slug = company?.slug || 'pontualtech'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
    const portalUrl = `${appUrl}/portal/${slug}`
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
    <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700">${companyName}</h1>
    <p style="color:#bfdbfe;margin:6px 0 0;font-size:13px">Assistencia Tecnica em Informatica</p>
  </div>

  <!-- BODY -->
  <div style="padding:32px 24px">

    <!-- Greeting -->
    <p style="font-size:16px;color:#1e293b;margin:0 0 8px">
      Ola <strong>${customerName}</strong>! 👋
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
          ${os.module_statuses?.name || 'Aberta'}
        </div>
      </div>

      <table style="width:100%;font-size:13px;color:#334155;border-collapse:collapse">
        <tr>
          <td style="padding:6px 0;color:#64748b;width:120px">Cliente</td>
          <td style="padding:6px 0;font-weight:500">${fullName}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Equipamento</td>
          <td style="padding:6px 0;font-weight:500">${equipment || 'Impressora'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Defeito</td>
          <td style="padding:6px 0;font-weight:500">${os.reported_issue || 'A diagnosticar'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Data</td>
          <td style="padding:6px 0;font-weight:500">${createdDate} as ${createdTime}</td>
        </tr>
        ${os.equipment_brand ? `<tr><td style="padding:6px 0;color:#64748b">Marca/Modelo</td><td style="padding:6px 0;font-weight:500">${os.equipment_brand} ${os.equipment_model || ''}</td></tr>` : ''}
      </table>
    </div>

    <!-- PRÓXIMOS PASSOS -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:0 0 24px">
      <p style="font-size:14px;font-weight:700;color:#166534;margin:0 0 12px">📋 Proximos passos:</p>
      <table style="font-size:13px;color:#334155;border-collapse:collapse;width:100%">
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top">1️⃣</td><td style="padding:4px 0">Nossos tecnicos vao analisar seu equipamento</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top">2️⃣</td><td style="padding:4px 0">Voce recebera o orcamento por email para aprovacao</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top">3️⃣</td><td style="padding:4px 0">Apos aprovado, o reparo sera realizado em ate 10 dias uteis</td></tr>
        <tr><td style="padding:4px 8px 4px 0;vertical-align:top">4️⃣</td><td style="padding:4px 0">Voce sera notificado quando o equipamento estiver pronto</td></tr>
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
        <li>Acesse <a href="${portalUrl}" style="color:#1e40af;font-weight:600">${portalUrl.replace('https://','')}</a></li>
        <li>Use seu <strong>CPF ou CNPJ</strong> como login</li>
        <li>No primeiro acesso, clique em <strong>"Criar senha"</strong></li>
        <li>Pronto! Voce pode acompanhar todas as suas OS</li>
      </ol>
    </div>

    <!-- CONTATO -->
    <div style="border-top:1px solid #e2e8f0;padding-top:20px;margin-top:8px">
      <p style="font-size:13px;color:#475569;margin:0 0 12px">
        Duvidas? Fale conosco:
      </p>
      <table style="font-size:13px;color:#334155;border-collapse:collapse">
        <tr>
          <td style="padding:4px 12px 4px 0">📞</td>
          <td style="padding:4px 0">${companyPhone}</td>
        </tr>
        <tr>
          <td style="padding:4px 12px 4px 0">💬</td>
          <td style="padding:4px 0"><a href="https://wa.me/${companyWhatsApp}" style="color:#16a34a;text-decoration:none;font-weight:500">WhatsApp</a></td>
        </tr>
        <tr>
          <td style="padding:4px 12px 4px 0">✉️</td>
          <td style="padding:4px 0"><a href="mailto:${companyEmail}" style="color:#1e40af;text-decoration:none">${companyEmail}</a></td>
        </tr>
      </table>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#1e293b;padding:20px 24px;text-align:center">
    <p style="color:#94a3b8;font-size:12px;margin:0 0 4px">${companyName}</p>
    <p style="color:#64748b;font-size:11px;margin:0">
      ${companySettings['address'] || companySettings['endereco'] || 'Sao Paulo — SP'}
    </p>
    ${companySettings['cnpj'] ? `<p style="color:#64748b;font-size:11px;margin:4px 0 0">CNPJ: ${companySettings['cnpj']}</p>` : ''}
    <p style="color:#475569;font-size:10px;margin:12px 0 0">
      Este email foi enviado automaticamente. Nao responda diretamente.
    </p>
  </div>

</div>
</body>
</html>`

    const subject = `OS-${osNum} aberta — ${equipment || 'Seu equipamento'} | ${companyName}`

    await sendEmail(customer.email, subject, html)

    // Update internal notes
    await prisma.serviceOrder.update({
      where: { id: os.id },
      data: {
        internal_notes: (os.internal_notes || '') + `\nEMAIL ABERTURA enviado para ${customer.email} em ${createdDate} ${createdTime}`,
      },
    })

    return success({ sent: true, to: customer.email, subject })
  } catch (err: any) {
    console.error('[notificar-abertura]', err.message)
    return handleError(err)
  }
}
