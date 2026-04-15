import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { sendCompanyEmail } from '@/lib/send-email'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { escapeHtml } from '@/lib/escape-html'

type Params = { params: { id: string } }

function fmtCents(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/**
 * POST /api/os/[id]/notificar-aprovacao
 * Envia notificacao detalhada de aprovacao ao cliente (email e/ou WhatsApp)
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
    if (!os) return error('OS nao encontrada', 404)

    const body = await req.json().catch(() => ({}))
    const channels: string[] = body.channels || ['email']

    // Load company settings
    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    const customerName = os.customers?.legal_name || 'Cliente'
    const customerFirstName = customerName.split(' ')[0]
    const customerEmail = os.customers?.email || ''
    const customerPhone = os.customers?.mobile || os.customers?.phone || ''
    const osNum = String(os.os_number)
    const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')
    const fmtValue = fmtCents(os.total_cost || 0)
    const companyName = os.companies?.name || cfg['company.name'] || 'Empresa'
    const companyPhone = cfg['company.phone'] || ''
    const whatsappNum = (cfg['company.whatsapp'] || '').replace(/\D/g, '')
    const whatsappUrl = whatsappNum ? `https://wa.me/${whatsappNum}` : ''
    const companyCnpj = cfg['cnab.cnpj'] || cfg['company.cnpj'] || ''
    const companyEmailAddr = cfg['company.email'] || ''
    const companyAddress = [cfg['cnab.endereco'], cfg['company.number'], cfg['cnab.bairro'], cfg['cnab.cidade'], cfg['cnab.uf']].filter(Boolean).join(', ')
    const companyCep = cfg['cnab.cep'] || ''
    const pixKey = cfg['pix.chave'] || companyCnpj
    const pixBanco = cfg['pix.banco'] || ''
    const horario = cfg['company.horario'] || 'Seg a Qui 08:00-18:00 | Sex 08:00-17:00'
    const previsao = os.estimated_delivery
      ? new Date(os.estimated_delivery).toLocaleDateString('pt-BR')
      : 'A confirmar'

    const results: { channel: string; status: string }[] = []

    // ===== WHATSAPP =====
    if (channels.includes('whatsapp')) {
      if (!customerPhone) {
        results.push({ channel: 'whatsapp', status: 'sem_telefone' })
      } else {
        try {
          const phone = customerPhone.replace(/\D/g, '')
          const fallback = `*Orcamento pronto — OS #${osNum}*\n\nValor: ${fmtValue}\nEquipamento: ${equipment || 'Equipamento'}\n\nAcesse o portal para aprovar ou recusar o orcamento.`
          const waResult = await sendWhatsAppTemplate(user.companyId, phone, 'pontualtech_orcamento', 'pt_BR', [
            { type: 'body', parameters: [
              { type: 'text', text: osNum },
              { type: 'text', text: fmtValue },
              { type: 'text', text: equipment || 'Equipamento' },
            ] }
          ], fallback)
          results.push({ channel: 'whatsapp', status: waResult.success ? 'enviado' : 'erro' })
        } catch {
          results.push({ channel: 'whatsapp', status: 'erro' })
        }
      }
    }

    // ===== EMAIL =====
    if (channels.includes('email')) {
      if (!customerEmail) {
        results.push({ channel: 'email', status: 'sem_email' })
      } else {
        // Try custom template first
        const customTemplate = await prisma.setting.findFirst({
          where: { company_id: user.companyId, key: 'email.template_aprovacao' },
        })

        const e = escapeHtml
        let emailHtml: string

        if (customTemplate?.value) {
          emailHtml = customTemplate.value
            .replace(/\{\{cliente_nome\}\}/g, e(customerFirstName))
            .replace(/\{\{cliente_nome_completo\}\}/g, e(customerName))
            .replace(/\{\{os_numero\}\}/g, osNum)
            .replace(/\{\{equipamento\}\}/g, e(equipment))
            .replace(/\{\{valor\}\}/g, fmtValue)
            .replace(/\{\{previsao\}\}/g, previsao)
            .replace(/\{\{empresa_nome\}\}/g, e(companyName))
            .replace(/\{\{empresa_endereco\}\}/g, e(companyAddress))
            .replace(/\{\{empresa_cep\}\}/g, e(companyCep))
            .replace(/\{\{empresa_cnpj\}\}/g, e(companyCnpj))
            .replace(/\{\{empresa_telefone\}\}/g, e(companyPhone))
            .replace(/\{\{empresa_email\}\}/g, e(companyEmailAddr))
            .replace(/\{\{empresa_whatsapp\}\}/g, whatsappUrl)
            .replace(/\{\{pix_chave\}\}/g, e(pixKey))
            .replace(/\{\{pix_banco\}\}/g, e(pixBanco))
            .replace(/\{\{horario\}\}/g, e(horario))
        } else {
          // Built-in professional template
          emailHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
<tr><td style="background:linear-gradient(135deg,#15803d,#22c55e);padding:36px 32px;text-align:center;">
  <div style="font-size:36px;margin:0 0 8px;">✅</div>
  <h1 style="margin:0 0 4px;color:#fff;font-size:20px;">Aprovacao Confirmada</h1>
  <p style="margin:0;color:rgba(255,255,255,.7);font-size:12px;">${e(companyName)} — OS #${osNum}</p>
</td></tr>
<tr><td style="padding:32px;">
  <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Prezado(a) <strong>${e(customerFirstName)}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
    Recebemos sua aprovacao e agradecemos pela confianca! Ja demos o sinal verde para nossa equipe tecnica e o reparo do seu equipamento sera iniciado imediatamente.
  </p>
  <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;padding:16px;margin:0 0 24px;">
    <table width="100%" style="font-size:14px;color:#1e293b;">
      <tr><td style="padding:6px 0;font-weight:700;width:150px;color:#64748b;">Equipamento:</td><td style="padding:6px 0;font-weight:600;">${e(equipment)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Valor aprovado:</td><td style="padding:6px 0;font-weight:800;font-size:18px;color:#15803d;">${fmtValue}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Previsao entrega:</td><td style="padding:6px 0;font-weight:700;">${previsao}</td></tr>
    </table>
  </div>
  <div style="margin:0 0 24px;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1e293b;">🛠️ Sobre o Servico e Prazos</h3>
    <ul style="margin:0;padding:0 0 0 20px;font-size:13px;color:#475569;line-height:1.8;">
      <li><strong>Inicio da Contagem:</strong> O prazo comeca a contar a partir de agora.</li>
      <li><strong>Agilidade:</strong> Nosso compromisso e finalizar e entregar o mais rapido possivel.</li>
      <li><strong>Aviso de Conclusao:</strong> Voce recebera uma notificacao assim que o servico for finalizado.</li>
    </ul>
  </div>
  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin:0 0 24px;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1e40af;">💳 Formas de Pagamento (na Entrega)</h3>
    <ul style="margin:0;padding:0 0 0 20px;font-size:13px;color:#1e40af;line-height:1.8;">
      <li><strong>Cartao de Credito:</strong> Parcelamos em ate 3x sem juros</li>
      <li><strong>PIX / Transferencia:</strong>${pixBanco ? ` ${e(pixBanco)} —` : ''} Chave PIX (CNPJ): ${e(pixKey)}</li>
      <li>Favorecido: ${e(companyName)}</li>
    </ul>
  </div>
  <div style="margin:0 0 24px;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1e293b;">🚚 Entrega e Horarios</h3>
    <p style="font-size:13px;color:#475569;line-height:1.7;margin:0;">
      Antes de levarmos o equipamento, entraremos em contato para confirmar se havera alguem no local.<br>
      <strong>Horarios:</strong> ${e(horario)}
    </p>
  </div>
  ${whatsappUrl ? `<div style="text-align:center;margin:0 0 16px;">
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#25d366;border-radius:8px;">
      <a href="${whatsappUrl}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;">
        💬 Fale conosco pelo WhatsApp
      </a>
    </td></tr></table>
  </div>` : ''}
</td></tr>
<tr><td style="padding:0 32px 24px;">
  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
    <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
    <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
      <td style="padding:0 6px;"><a href="${(() => { const pb = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'; const sl = os.companies?.slug || 'pontualtech'; return pb + '/portal/' + sl; })()}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
      <td style="padding:0 6px;"><a href="${(cfg['company.website'] || 'https://pontualtech.com.br') + '/#consulta-os'}" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>
    </tr></table>
    <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
    <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
      <td><a href="${whatsappUrl || 'https://wa.me/551126263841'}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
    </tr></table>
  </div>
</td></tr>
<tr><td style="background:#1e293b;padding:24px 32px;text-align:center;">
  <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">${e(companyName)}</p>
  <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">📍 ${e(companyAddress)}${companyCep ? ` — CEP ${e(companyCep)}` : ''}</p>
  <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">📞 ${e(companyPhone)} | ✉️ ${e(companyEmailAddr)} | CNPJ: ${e(companyCnpj)}</p>
  <div style="border-top:1px solid #334155;padding-top:10px;margin-top:10px;">
    <p style="margin:0;font-size:10px;color:#64748b;">⚙️ Esta e uma mensagem automatica. Nao responda diretamente este email.</p>
  </div>
</td></tr>
</table></td></tr></table></body></html>`
        }

        try {
          await sendCompanyEmail(
            user.companyId,
            customerEmail,
            `Aprovacao Confirmada — Orcamento #${osNum} — ${companyName}`,
            emailHtml
          )
          results.push({ channel: 'email', status: 'enviado' })
        } catch {
          results.push({ channel: 'email', status: 'erro' })
        }
      }
    }

    return success({ results })
  } catch (err) {
    return handleError(err)
  }
}
