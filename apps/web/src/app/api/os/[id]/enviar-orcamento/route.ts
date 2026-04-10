import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendEmail } from '@/lib/send-email'
import { createHmac } from 'crypto'

type Params = { params: { id: string } }

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(date: Date | string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('pt-BR')
}

function generateOrcamentoToken(osId: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY nao configurada')
  return createHmac('sha256', key).update('orcamento:' + osId).digest('hex').slice(0, 16)
}

function replaceTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '')
  }
  return result
}

function buildItemsTable(items: any[]): string {
  const servicos = items.filter(i => i.item_type !== 'PECA')
  const pecas = items.filter(i => i.item_type === 'PECA')

  let html = ''

  if (servicos.length > 0) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <tr>
        <td colspan="4" style="padding:12px 16px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;">
          Servicos Tecnicos
        </td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-transform:uppercase;letter-spacing:0.5px;">Descricao</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:center;width:50px;text-transform:uppercase;letter-spacing:0.5px;">Qtd</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:right;width:90px;text-transform:uppercase;letter-spacing:0.5px;">Unit.</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:right;width:100px;text-transform:uppercase;letter-spacing:0.5px;">Subtotal</td>
      </tr>`
    for (let idx = 0; idx < servicos.length; idx++) {
      const item = servicos[idx]
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc'
      html += `<tr style="background:${bg};">
        <td style="padding:12px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${item.description || '\u2014'}</td>
        <td style="padding:12px 16px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;text-align:center;">${item.quantity}</td>
        <td style="padding:12px 16px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtCents(item.unit_price)}</td>
        <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#1e293b;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtCents(item.total_price)}</td>
      </tr>`
    }
    html += `</table>`
  }

  if (pecas.length > 0) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <tr>
        <td colspan="4" style="padding:12px 16px;background:#7c3aed;color:#fff;font-weight:700;font-size:14px;">
          Pecas e Componentes
        </td>
      </tr>
      <tr style="background:#f8fafc;">
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-transform:uppercase;letter-spacing:0.5px;">Descricao</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:center;width:50px;text-transform:uppercase;letter-spacing:0.5px;">Qtd</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:right;width:90px;text-transform:uppercase;letter-spacing:0.5px;">Unit.</td>
        <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;border-bottom:2px solid #e2e8f0;text-align:right;width:100px;text-transform:uppercase;letter-spacing:0.5px;">Subtotal</td>
      </tr>`
    for (let idx = 0; idx < pecas.length; idx++) {
      const item = pecas[idx]
      const bg = idx % 2 === 0 ? '#ffffff' : '#faf5ff'
      html += `<tr style="background:${bg};">
        <td style="padding:12px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${item.description || '\u2014'}</td>
        <td style="padding:12px 16px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;text-align:center;">${item.quantity}</td>
        <td style="padding:12px 16px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtCents(item.unit_price)}</td>
        <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#1e293b;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtCents(item.total_price)}</td>
      </tr>`
    }
    html += `</table>`
  }

  return html
}

const DEFAULT_QUOTE_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orcamento Pronto - {{company_name}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 50%,#3b82f6 100%);padding:36px 32px;text-align:center;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <div style="width:64px;height:64px;background:rgba(255,255,255,0.15);border-radius:16px;margin:0 auto 12px;line-height:64px;font-size:28px;">&#128736;</div>
                    <h1 style="margin:0 0 6px;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.3px;">{{company_name}}</h1>
                    <p style="margin:0 0 4px;color:rgba(255,255,255,0.7);font-size:12px;">Assistencia Tecnica Profissional</p>
                    <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:20px;padding:6px 20px;margin-top:10px;">
                      <p style="margin:0;color:#ffffff;font-size:14px;font-weight:700;letter-spacing:0.3px;">SEU ORCAMENTO ESTA PRONTO!</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:32px 32px 0;">
              <!-- Greeting -->
              <p style="margin:0 0 16px;font-size:17px;color:#1e293b;line-height:1.4;">
                Ola <strong>{{customer_name}}</strong>,
              </p>
              <p style="margin:0 0 8px;font-size:14px;color:#475569;line-height:1.7;">
                Temos uma boa noticia! Nossos tecnicos finalizaram a analise do seu
                <strong style="color:#1e293b;">{{equipment}}</strong> (OS #{{os_number}}) e seu orcamento ja esta disponivel.
              </p>
              <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.7;">
                Acesse seu <strong style="color:#1e40af;">Painel do Cliente</strong> para ver todos os detalhes, aprovar o servico e acompanhar cada etapa em tempo real.
              </p>

              <!-- VALOR DESTAQUE -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:12px;padding:28px 24px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:12px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:1px;font-weight:600;">Investimento</p>
                    <p style="margin:0 0 8px;font-size:30px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                      {{installment_info}}
                    </p>
                    <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);">
                      Valor total: {{total_cost}}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Info pills -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
                <tr>
                  <td width="33%" style="padding:0 4px 0 0;">
                    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 12px;text-align:center;">
                      <p style="margin:0 0 2px;font-size:11px;color:#3b82f6;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Prazo</p>
                      <p style="margin:0;font-size:13px;color:#1e40af;font-weight:600;">{{execution_days}}</p>
                    </div>
                  </td>
                  <td width="33%" style="padding:0 4px;">
                    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 12px;text-align:center;">
                      <p style="margin:0 0 2px;font-size:11px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Garantia</p>
                      <p style="margin:0;font-size:13px;color:#15803d;font-weight:600;">{{warranty_period}}</p>
                    </div>
                  </td>
                  <td width="33%" style="padding:0 0 0 4px;">
                    <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px 12px;text-align:center;">
                      <p style="margin:0 0 2px;font-size:11px;color:#d97706;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Validade</p>
                      <p style="margin:0;font-size:13px;color:#92400e;font-weight:600;">{{quote_validity}}</p>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- MOTIVATIONAL TRIGGER + PORTAL CTA -->
              <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:16px;padding:32px 24px;margin-bottom:24px;text-align:center;">
                <div style="width:56px;height:56px;background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:14px;margin:0 auto 16px;line-height:56px;font-size:24px;">&#128640;</div>
                <p style="margin:0 0 8px;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">
                  Seu equipamento pode voltar a funcionar!
                </p>
                <p style="margin:0 0 20px;font-size:14px;color:#94a3b8;line-height:1.6;">
                  No seu Painel voce confere o diagnostico completo, todos os servicos e pecas detalhados, e aprova com apenas um clique.
                </p>

                <!-- Checklist motivacional -->
                <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;text-align:left;">
                  <tr>
                    <td style="padding:4px 0;font-size:13px;color:#22c55e;">&#10003;</td>
                    <td style="padding:4px 0 4px 8px;font-size:13px;color:#e2e8f0;">Veja o laudo tecnico detalhado</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;font-size:13px;color:#22c55e;">&#10003;</td>
                    <td style="padding:4px 0 4px 8px;font-size:13px;color:#e2e8f0;">Confira todos os servicos e pecas</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;font-size:13px;color:#22c55e;">&#10003;</td>
                    <td style="padding:4px 0 4px 8px;font-size:13px;color:#e2e8f0;">Aprove o servico em um clique</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;font-size:13px;color:#22c55e;">&#10003;</td>
                    <td style="padding:4px 0 4px 8px;font-size:13px;color:#e2e8f0;">Acompanhe cada etapa em tempo real</td>
                  </tr>
                </table>

                <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                  <tr>
                    <td style="background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:12px;box-shadow:0 4px 16px rgba(34,197,94,0.4);">
                      <a href="{{portal_os_link}}" target="_blank"
                         style="display:inline-block;color:#ffffff;text-decoration:none;font-size:17px;font-weight:800;padding:18px 48px;letter-spacing:0.3px;">
                        ACESSAR MEU PAINEL
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="font-size:11px;color:#64748b;margin:14px 0 0;">Primeiro acesso? Use seu CPF/CNPJ como login e crie sua senha.</p>
              </div>

              <!-- Urgencia sutil -->
              <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin-bottom:24px;text-align:center;">
                <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                  <strong>&#9200; Orcamento valido por {{quote_validity}}.</strong> Aprovando dentro do prazo, garantimos as condicoes e priorizamos seu atendimento.
                </p>
              </div>

              <!-- Eco tip -->
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
                <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
                  <strong>&#127793; Voce sabia?</strong> Reparar seu equipamento custa ate 70% menos do que comprar um novo e ainda ajuda a reduzir o lixo eletronico.
                </p>
              </div>

              <!-- Conditions (compact) -->
              <div style="border-top:2px solid #e2e8f0;padding-top:20px;margin-bottom:24px;">
                <p style="margin:0 0 12px;font-size:13px;color:#1e293b;font-weight:700;">Formas de pagamento</p>
                <p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.6;">{{payment_conditions}}</p>
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:#64748b;">
                  <tr>
                    <td style="padding:4px 0;">PIX: {{company_pix}}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;">Banco: {{company_bank}}</td>
                  </tr>
                </table>
              </div>

              <!-- Suporte DISCRETO -->
              <div style="text-align:center;margin-bottom:24px;padding-top:8px;border-top:1px solid #f1f5f9;">
                <p style="margin:0;font-size:11px;color:#94a3b8;">
                  Precisa de ajuda? <a href="https://wa.me/{{company_whatsapp}}" target="_blank" style="color:#94a3b8;text-decoration:underline;">Fale conosco</a>
                </p>
              </div>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1e293b;padding:24px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">{{company_name}}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#64748b;">{{company_address}}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#64748b;">CNPJ: {{company_cnpj}} | Tel: {{company_phone}}</p>
              <p style="margin:0;font-size:11px;color:#64748b;">{{company_email}} | {{company_website}}</p>
            </td>
          </tr>

        </table>

        <!-- Footer info -->
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:16px 0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                Este email foi enviado por {{company_name}} referente a OS #{{os_number}}.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

async function loadOSData(osId: string, companyId: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(osId)
  const isNumber = /^\d{1,10}$/.test(osId)
  if (!isUuid && !isNumber) return null
  const where = isUuid
    ? { id: osId, company_id: companyId, deleted_at: null }
    : { os_number: parseInt(osId, 10), company_id: companyId, deleted_at: null as any }
  const os = await prisma.serviceOrder.findFirst({
    where,
    include: {
      customers: true,
      service_order_items: { where: { deleted_at: null } },
      module_statuses: true,
      companies: { select: { id: true, name: true, slug: true } },
    },
  })
  return os
}

async function loadSettings(companyId: string): Promise<Record<string, string>> {
  const settings = await prisma.setting.findMany({
    where: { company_id: companyId },
  })
  const map: Record<string, string> = {}
  for (const s of settings) {
    map[s.key] = s.value
  }
  return map
}

function buildTemplateVars(os: any, settings: Record<string, string>, approvalLink: string): Record<string, string> {
  const c = os.customers
  const companyName = os.companies?.name || settings['company.name'] || 'Empresa'
  const osNumber = String(os.os_number).padStart(4, '0')
  const totalCost = os.total_cost ?? 0

  const companyAddress = settings['company.address'] ||
    settings['endereco'] ||
    [settings['company.street'], settings['company.number'], settings['company.city'], settings['company.state']]
      .filter(Boolean)
      .join(', ') || ''

  const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model]
    .filter(Boolean)
    .join(' ')

  // Installment info
  const maxInstallments = parseInt(settings['quote.max_installments'] || '3') || 3
  let installmentInfo = ''
  if (totalCost > 0 && maxInstallments > 1) {
    const installmentValue = fmtCents(Math.ceil(totalCost / maxInstallments))
    installmentInfo = `${maxInstallments}x de ${installmentValue} sem juros!`
  } else {
    installmentInfo = `A vista: ${fmtCents(totalCost)}`
  }

  const warrantyPeriod = settings['quote.warranty'] || '3 MESES'
  const executionDays = settings['quote.execution_days'] || '10 dias uteis'
  const quoteValidity = settings['quote.validity'] || '7 dias'
  const paymentConditions = settings['quote.payment_conditions'] || 'PIX, Dinheiro, Cartao de credito (ate 3x sem juros), Cartao de debito'
  const whatsapp = (settings['company.whatsapp'] || settings['whatsapp'] || settings['company.phone'] || '').replace(/\D/g, '')

  const items = os.service_order_items || []
  const itemsTable = buildItemsTable(items)

  const laudo = os.diagnosis || ''
  const obs = os.reception_notes || ''
  const hasLaudoOrObs = laudo || obs || os.reported_issue

  const laudoSection = hasLaudoOrObs
    ? `<div style="background:#ffffff;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
        <div style="background:#f8fafc;padding:12px 16px;border-bottom:2px solid #e2e8f0;">
          <p style="margin:0;font-size:13px;color:#1e293b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Laudo Tecnico</p>
        </div>
        <div style="padding:16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:0 0 12px;vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Problema Relatado</p>
                <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">${os.reported_issue || '\u2014'}</p>
              </td>
            </tr>
            ${laudo ? `<tr>
              <td style="padding:12px 0;border-top:1px solid #f1f5f9;vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Diagnostico / Laudo</p>
                <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">${laudo}</p>
              </td>
            </tr>` : ''}
            ${obs ? `<tr>
              <td style="padding:12px 0 0;border-top:1px solid #f1f5f9;vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Observacoes</p>
                <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">${obs}</p>
              </td>
            </tr>` : ''}
          </table>
        </div>
      </div>`
    : ''

  return {
    customer_name: c?.legal_name || c?.trade_name || 'Cliente',
    equipment,
    equipment_serial: os.serial_number || '',
    os_number: osNumber,
    reported_issue: os.reported_issue || '',
    laudo,
    laudo_section: laudoSection,
    items_table: itemsTable,
    total_cost: fmtCents(totalCost),
    installment_info: installmentInfo,
    approval_link: approvalLink,
    warranty_period: warrantyPeriod,
    execution_days: executionDays,
    quote_validity: quoteValidity,
    company_name: companyName,
    company_phone: settings['company.phone'] || settings['telefone'] || '',
    company_whatsapp: whatsapp,
    company_address: companyAddress,
    company_cnpj: settings['company.cnpj'] || settings['cnpj'] || '',
    company_email: settings['company.email'] || settings['email'] || '',
    company_website: settings['company.website'] || settings['website'] || '',
    company_pix: settings['company.pix'] || settings['pix'] || '',
    company_bank: settings['company.bank'] || settings['banco'] || '',
    payment_conditions: paymentConditions,
    portal_os_link: (() => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
      const slug = os.companies?.slug || 'pontualtech'
      const doc = c?.document_number || ''
      const base = `${appUrl}/portal/${slug}/os/${os.id}`
      return doc ? `${base}?doc=${doc}` : base
    })(),
  }
}

/**
 * GET /api/os/{id}/enviar-orcamento
 * Returns rendered HTML preview of the quote email
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await loadOSData(params.id, user.companyId)
    if (!os) return error('OS nao encontrada', 404)

    const settings = await loadSettings(user.companyId)

    // Load custom template or use default
    const msgTemplate = await prisma.messageTemplate.findFirst({
      where: { company_id: user.companyId, trigger: 'quote_email', channel: 'email', is_active: true },
    })
    const htmlTemplate = msgTemplate?.template || DEFAULT_QUOTE_TEMPLATE

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
    const slug = os.companies?.slug || 'default'
    const token = generateOrcamentoToken(os.id)
    const approvalLink = `${appUrl}/portal/${slug}/orcamento/${os.id}?token=${token}`

    const vars = buildTemplateVars(os, settings, approvalLink)
    const renderedHtml = replaceTemplateVars(htmlTemplate, vars)

    return new NextResponse(renderedHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST /api/os/{id}/enviar-orcamento
 * Sends the quote email to the customer
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const { to } = body as { to?: string }

    const os = await loadOSData(params.id, user.companyId)
    if (!os) return error('OS nao encontrada', 404)

    const recipientEmail = to || os.customers?.email
    if (!recipientEmail) {
      return error('Email do cliente nao informado', 400)
    }

    const settings = await loadSettings(user.companyId)

    // Load custom template or use default
    const msgTemplate = await prisma.messageTemplate.findFirst({
      where: { company_id: user.companyId, trigger: 'quote_email', channel: 'email', is_active: true },
    })
    const htmlTemplate = msgTemplate?.template || DEFAULT_QUOTE_TEMPLATE

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
    const slug = os.companies?.slug || 'default'
    const token = generateOrcamentoToken(os.id)
    const approvalLink = `${appUrl}/portal/${slug}/orcamento/${os.id}?token=${token}`

    const vars = buildTemplateVars(os, settings, approvalLink)
    const renderedHtml = replaceTemplateVars(htmlTemplate, vars)

    const companyName = os.companies?.name || settings['company.name'] || 'Empresa'
    const osNumber = String(os.os_number).padStart(4, '0')
    const subject = `Orcamento OS-${osNumber} - ${companyName}`

    const sent = await sendEmail(recipientEmail, subject, renderedHtml)
    if (!sent) {
      return error('Erro ao enviar email. Verifique a configuracao do RESEND_API_KEY.', 500)
    }

    // Audit log
    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'quote_email_sent',
      entityId: os.id,
      newValue: { to: recipientEmail, subject },
    })

    // Update OS notes
    const now = new Date()
    const dateStr = now.toLocaleDateString('pt-BR')
    const currentNotes = os.reception_notes || ''
    const appendNote = `Orcamento enviado por email em ${dateStr}`
    const updatedNotes = currentNotes
      ? `${currentNotes}\n${appendNote}`
      : appendNote

    await prisma.serviceOrder.update({
      where: { id: os.id },
      data: { reception_notes: updatedNotes },
    })

    return success({ sent: true, to: recipientEmail, subject })
  } catch (err) {
    return handleError(err)
  }
}
