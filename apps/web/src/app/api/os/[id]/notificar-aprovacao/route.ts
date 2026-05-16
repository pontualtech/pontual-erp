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

    const { toTitleCase } = await import('@/lib/format-text')
    const customerName = toTitleCase(os.customers?.legal_name || 'Cliente')
    const customerFirstName = customerName.split(' ')[0]
    const customerEmail = os.customers?.email || ''
    const customerPhone = os.customers?.mobile || os.customers?.phone || ''
    const osNum = String(os.os_number)
    const equipment = toTitleCase([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '))
    const fmtValue = fmtCents(os.total_cost || 0)
    const companyName = os.companies?.name || cfg['company.name'] || 'Empresa'
    const companyPhone = cfg['company.phone'] || ''
    const whatsappNum = (cfg['company.whatsapp'] || '').replace(/\D/g, '')
    const whatsappUrl = whatsappNum ? `https://wa.me/${whatsappNum}` : ''
    // Address/CNPJ: read from company.* keys first (populated for all tenants)
    // and only fall back to cnab.* (which may only exist when Banco Inter billing
    // is enabled). Previously cnab.* was the primary source — Imprimitech didn't
    // have those keys, so emails arrived with empty commas.
    const companyCnpj = cfg['company.cnpj'] || cfg['cnab.cnpj'] || ''
    const companyEmailAddr = cfg['company.email'] || ''
    const companyAddress = [
      cfg['company.address'] || cfg['cnab.endereco'],
      cfg['company.number'],
      cfg['company.neighborhood'] || cfg['cnab.bairro'],
      cfg['company.city'] || cfg['cnab.cidade'],
      cfg['company.state'] || cfg['cnab.uf'],
    ].filter(Boolean).join(', ')
    const companyCep = cfg['company.cep'] || cfg['cnab.cep'] || ''
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
          // pontualtech_orcamento_v2: template com botao URL contendo magic-link.
          // Cloud API (PT) → renderiza "Aprovar ou Recusar" clicavel; Evolution (IM) → texto plano com URL.
          const { createAccessToken } = await import('@/lib/portal-auth')
          const magicToken = createAccessToken(os.customer_id, user.companyId)
          const company = await prisma.company.findUnique({ where: { id: user.companyId }, select: { slug: true } })
          const slug = company?.slug || 'pontualtech'
          const isImpri = slug.includes('imprimitech')
          const portalDomain = isImpri ? 'portal.imprimitech.com.br' : 'portal.pontualtech.com.br'
          const magicRedirect = encodeURIComponent(`/portal/${slug}/os/${os.id}`)
          const magicLink = `https://${portalDomain}/portal/${slug}/entrar?t=${magicToken}&r=${magicRedirect}`
          // Encurta magic-link (~230 chars) pra /s/SLUG no fallback WhatsApp.
          // Botao Cloud (Meta) continua com token cru. Falha graceful pro original.
          let magicLinkShort = magicLink
          try {
            const { shortenUrl } = await import('@/lib/short-link')
            magicLinkShort = await shortenUrl(magicLink, user.companyId, os.customer_id)
          } catch (shortErr) {
            console.warn('[notificar-aprovacao] shortener falhou:', shortErr instanceof Error ? shortErr.message : shortErr)
          }
          // v3 (2026-05-06): sem valor no body. Cliente ve detalhes no portal
          // antes de aprovar/recusar — evita rejeicao "as cegas" so pelo numero.
          const fallback = `*Orcamento pronto — OS #${osNum}*\n\nEquipamento: ${equipment || 'Equipamento'}\n\nOs detalhes do orcamento (valor, pecas, fotos) estao disponiveis no Portal.\nToque para acessar e aprovar ou recusar:\n${magicLinkShort}`
          const waResult = await sendWhatsAppTemplate(user.companyId, phone, 'pontualtech_orcamento_v3', 'pt_BR', [
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
          // Built-in template v3 (2026-05-06): SEM valor. Forca cliente
          // a acessar o portal pra ver detalhes (servicos, pecas, fotos)
          // antes de aprovar — evita rejeicao "as cegas" so pelo numero.
          // Removidas secoes "Formas de pagamento", "Entrega/horarios"
          // e "Sobre o servico e prazos" (so fazem sentido pos-aprovacao).
          const portalCtaUrl = await (async () => {
            const PORTAL_DOMAIN_BY_SLUG: Record<string, string> = {
              pontualtech: 'portal.pontualtech.com.br',
              imprimitech: 'portal.imprimitech.com.br',
            }
            const sl = os.companies?.slug || ''
            const pb = process.env.PORTAL_URL
              || (sl ? `https://${PORTAL_DOMAIN_BY_SLUG[sl] || `portal.${sl}.com.br`}` : 'https://portal.pontualtech.com.br')
            const { createAccessToken: catEmailAprov } = await import('@/lib/portal-auth')
            const tokenEmailAprov = catEmailAprov(os.customer_id, user.companyId)
            const redirEmailAprov = encodeURIComponent(`/portal/${sl}/os/${os.id}`)
            return sl ? `${pb}/portal/${sl}/entrar?t=${tokenEmailAprov}&r=${redirEmailAprov}` : pb
          })()
          emailHtml = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
<tr><td style="background:linear-gradient(135deg,#15803d,#22c55e);padding:36px 32px;text-align:center;">
  <div style="font-size:36px;margin:0 0 8px;">📋</div>
  <h1 style="margin:0 0 4px;color:#fff;font-size:20px;">Orcamento Pronto para Aprovacao</h1>
  <p style="margin:0;color:rgba(255,255,255,.85);font-size:12px;">${e(companyName)} — OS #${osNum}</p>
</td></tr>
<tr><td style="padding:32px;">
  <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Prezado(a) <strong>${e(customerFirstName)}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 20px;">
    Boas noticias! O orcamento da sua Ordem de Servico esta pronto para sua avaliacao. Acesse o Portal do Cliente para revisar todos os detalhes (servicos, pecas e fotos do diagnostico) e aprovar ou recusar quando achar conveniente.
  </p>
  <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;padding:16px;margin:0 0 24px;">
    <table width="100%" style="font-size:14px;color:#1e293b;">
      <tr><td style="padding:6px 0;font-weight:700;width:160px;color:#64748b;">Ordem de Servico:</td><td style="padding:6px 0;font-weight:700;">#${osNum}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Equipamento:</td><td style="padding:6px 0;font-weight:600;">${e(equipment)}</td></tr>
    </table>
  </div>
  <div style="text-align:center;margin:0 0 24px;">
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#15803d;border-radius:10px;">
      <a href="${portalCtaUrl}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;">
        Ver Orcamento e Aprovar
      </a>
    </td></tr></table>
    <p style="margin:12px 0 0;font-size:12px;color:#64748b;">Acesso direto, sem senha.</p>
  </div>
  ${whatsappUrl ? `<div style="text-align:center;margin:0;border-top:1px solid #e2e8f0;padding-top:20px;">
    <p style="margin:0 0 10px;font-size:13px;color:#475569;">Duvidas? Fale com nosso suporte:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#25d366;border-radius:8px;">
      <a href="${whatsappUrl}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 24px;">
        💬 WhatsApp Suporte
      </a>
    </td></tr></table>
  </div>` : ''}
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
            `Orcamento pronto — OS #${osNum} — Aguardando sua aprovacao`,
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
