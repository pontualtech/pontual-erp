import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendCompanyEmail } from '@/lib/send-email'
import { createHmac } from 'crypto'
import { createAccessToken } from '@/lib/portal-auth'
import { escapeHtml } from '@/lib/escape-html'

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
        <td style="padding:12px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${escapeHtml(item.description) || '\u2014'}</td>
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
        <td style="padding:12px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${escapeHtml(item.description) || '\u2014'}</td>
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
  <!--[if mso]><style>table{border-collapse:collapse;}td,th{padding:0;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:0;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

          <!-- LOGO BAR -->
          <tr>
            <td style="padding:20px 0 24px;text-align:center;">
              <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">{{company_name}}</p>
            </td>
          </tr>

          <!-- HERO CARD -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;">

                <!-- Status badge -->
                <tr>
                  <td style="padding:32px 28px 0;text-align:center;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                      <tr>
                        <td style="background:#dcfce7;border-radius:24px;padding:8px 20px;">
                          <p style="margin:0;font-size:12px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:1px;">&#9679; Orcamento pronto</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Greeting -->
                <tr>
                  <td style="padding:24px 28px 0;text-align:center;">
                    <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#0f172a;line-height:1.3;">
                      {{customer_name}}, seu orcamento esta pronto
                    </h1>
                    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.6;">
                      Finalizamos a analise do seu <strong style="color:#334155;">{{equipment}}</strong> e o orcamento completo esta disponivel no seu painel.
                    </p>
                  </td>
                </tr>

                <!-- OS info strip -->
                <tr>
                  <td style="padding:24px 28px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
                      <tr>
                        <td width="50%" style="padding:16px 20px;border-right:1px solid #e2e8f0;">
                          <p style="margin:0 0 2px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Ordem de Servico</p>
                          <p style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">#{{os_number}}</p>
                        </td>
                        <td width="50%" style="padding:16px 20px;">
                          <p style="margin:0 0 2px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Validade</p>
                          <p style="margin:0;font-size:18px;font-weight:800;color:#0f172a;">{{quote_validity}}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- What's inside -->
                <tr>
                  <td style="padding:24px 28px 0;">
                    <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;">O que voce encontra no painel</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                            <td width="32" style="vertical-align:top;">
                              <div style="width:28px;height:28px;background:#eff6ff;border-radius:8px;text-align:center;line-height:28px;font-size:14px;">&#128269;</div>
                            </td>
                            <td style="padding-left:12px;vertical-align:middle;">
                              <p style="margin:0;font-size:14px;color:#334155;font-weight:600;">Diagnostico tecnico completo</p>
                              <p style="margin:2px 0 0;font-size:12px;color:#94a3b8;">O que foi encontrado e o que precisa ser feito</p>
                            </td>
                          </tr></table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                            <td width="32" style="vertical-align:top;">
                              <div style="width:28px;height:28px;background:#f0fdf4;border-radius:8px;text-align:center;line-height:28px;font-size:14px;">&#128176;</div>
                            </td>
                            <td style="padding-left:12px;vertical-align:middle;">
                              <p style="margin:0;font-size:14px;color:#334155;font-weight:600;">Valores detalhados</p>
                              <p style="margin:2px 0 0;font-size:12px;color:#94a3b8;">Servicos, pecas e condicoes de pagamento</p>
                            </td>
                          </tr></table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                            <td width="32" style="vertical-align:top;">
                              <div style="width:28px;height:28px;background:#fef3c7;border-radius:8px;text-align:center;line-height:28px;font-size:14px;">&#9989;</div>
                            </td>
                            <td style="padding-left:12px;vertical-align:middle;">
                              <p style="margin:0;font-size:14px;color:#334155;font-weight:600;">Aprovacao com um clique</p>
                              <p style="margin:2px 0 0;font-size:12px;color:#94a3b8;">Aprove e ja iniciamos o reparo imediatamente</p>
                            </td>
                          </tr></table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:10px 0;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                            <td width="32" style="vertical-align:top;">
                              <div style="width:28px;height:28px;background:#ede9fe;border-radius:8px;text-align:center;line-height:28px;font-size:14px;">&#128225;</div>
                            </td>
                            <td style="padding-left:12px;vertical-align:middle;">
                              <p style="margin:0;font-size:14px;color:#334155;font-weight:600;">Acompanhamento em tempo real</p>
                              <p style="margin:2px 0 0;font-size:12px;color:#94a3b8;">Cada etapa atualizada automaticamente</p>
                            </td>
                          </tr></table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td style="padding:28px 28px 8px;text-align:center;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#0f172a;border-radius:14px;">
                          <a href="{{portal_os_link}}" target="_blank"
                             style="display:block;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;padding:18px 24px;text-align:center;letter-spacing:0.3px;">
                            VER MEU ORCAMENTO &#8594;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:8px 28px 28px;text-align:center;">
                    <p style="margin:0;font-size:12px;color:#94a3b8;">Acesso seguro e instantaneo — sem senha.</p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- TRUST STRIP -->
          <tr>
            <td style="padding:20px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="33%" style="text-align:center;padding:0 4px;">
                    <p style="margin:0 0 2px;font-size:20px;">&#128337;</p>
                    <p style="margin:0;font-size:11px;color:#64748b;font-weight:600;">{{execution_days}}</p>
                  </td>
                  <td width="33%" style="text-align:center;padding:0 4px;">
                    <p style="margin:0 0 2px;font-size:20px;">&#128737;</p>
                    <p style="margin:0;font-size:11px;color:#64748b;font-weight:600;">{{warranty_period}}</p>
                  </td>
                  <td width="33%" style="text-align:center;padding:0 4px;">
                    <p style="margin:0 0 2px;font-size:20px;">&#127793;</p>
                    <p style="margin:0;font-size:11px;color:#64748b;font-weight:600;">Eco-friendly</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ACOMPANHE SUA OS -->
          <tr>
            <td style="padding:0 20px 24px;">
              <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
                <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
                <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                  <td style="padding:0 6px;"><a href="{{portal_os_link}}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
                  <td style="padding:0 6px;"><a href="{{company_website}}/#consulta-os" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>
                </tr></table>
                <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
                <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
                  <td><a href="https://wa.me/{{company_whatsapp}}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
                </tr></table>
              </div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:0 0 12px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#475569;">{{company_name}}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#475569;">{{company_phone}} | {{company_email}}</p>
              <p style="margin:0 0 12px;font-size:11px;color:#64748b;">
                <a href="https://wa.me/{{company_whatsapp}}" target="_blank" style="color:#64748b;text-decoration:underline;">WhatsApp</a>
              </p>
              <p style="margin:0 0 8px;font-size:10px;color:#334155;">OS #{{os_number}} | {{company_cnpj}}</p>
              <p style="margin:0;font-size:10px;color:#64748b;">⚙️ Esta e uma mensagem automatica. Nao responda diretamente este email.</p>
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

function buildTemplateVars(os: any, settings: Record<string, string>, approvalLink: string, toTitleCase?: (s: string) => string): Record<string, string> {
  const tc = toTitleCase || ((s: string) => s)
  const c = os.customers
  const companyName = os.companies?.name || settings['company.name'] || 'Empresa'
  const osNumber = String(os.os_number).padStart(4, '0')
  const totalCost = os.total_cost ?? 0

  const companyAddress = settings['company.address'] ||
    settings['endereco'] ||
    [settings['company.street'], settings['company.number'], settings['company.city'], settings['company.state']]
      .filter(Boolean)
      .join(', ') || ''

  const equipment = tc([os.equipment_type, os.equipment_brand, os.equipment_model]
    .filter(Boolean)
    .join(' '))

  // Detect recalculated quote
  const statusName = os.module_statuses?.name || ''
  const isRecalculado = /recalculad/i.test(statusName)
  const customData = (os.custom_data || {}) as Record<string, any>
  const originalCost = customData.original_cost || 0
  const hasRecalcDiscount = isRecalculado && originalCost > 0 && originalCost > totalCost
  const recalcDiscountAmount = hasRecalcDiscount ? originalCost - totalCost : 0
  const recalcDiscountPercent = hasRecalcDiscount ? Math.round((recalcDiscountAmount / originalCost) * 100) : 0

  // Normal discount (applied by attendant via discount_amount field)
  const dbDiscount = os.discount_amount ?? 0
  const subtotal = (os.total_services ?? 0) + (os.total_parts ?? 0)
  const hasNormalDiscount = !hasRecalcDiscount && dbDiscount > 0 && subtotal > 0
  const hasDiscount = hasRecalcDiscount || hasNormalDiscount
  const discountAmount = hasRecalcDiscount ? recalcDiscountAmount : dbDiscount
  const discountPercent = hasRecalcDiscount
    ? recalcDiscountPercent
    : (hasNormalDiscount ? Math.round((dbDiscount / subtotal) * 100) : 0)

  // Installment info — 5x for recalculated, configurable for normal
  const maxInstallments = isRecalculado ? 5 : (parseInt(settings['quote.max_installments'] || '3') || 3)
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
                <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">${escapeHtml(os.reported_issue) || '\u2014'}</p>
              </td>
            </tr>
            ${laudo ? `<tr>
              <td style="padding:12px 0;border-top:1px solid #f1f5f9;vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Diagnostico / Laudo</p>
                <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">${escapeHtml(laudo)}</p>
              </td>
            </tr>` : ''}
            ${obs ? `<tr>
              <td style="padding:12px 0 0;border-top:1px solid #f1f5f9;vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Observacoes</p>
                <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">${escapeHtml(obs)}</p>
              </td>
            </tr>` : ''}
          </table>
        </div>
      </div>`
    : ''

  return {
    customer_name: escapeHtml(tc(c?.legal_name || c?.trade_name || 'Cliente')),
    equipment: escapeHtml(equipment),
    equipment_serial: escapeHtml(os.serial_number || ''),
    os_number: osNumber,
    reported_issue: escapeHtml(os.reported_issue || ''),
    laudo: escapeHtml(laudo),
    laudo_section: laudoSection,
    items_table: itemsTable,
    total_cost: fmtCents(totalCost),
    installment_info: installmentInfo,
    approval_link: approvalLink,
    warranty_period: warrantyPeriod,
    execution_days: executionDays,
    quote_validity: quoteValidity,
    company_name: escapeHtml(companyName),
    company_phone: escapeHtml(settings['company.phone'] || settings['telefone'] || ''),
    company_whatsapp: whatsapp,
    company_address: escapeHtml(companyAddress),
    company_cnpj: escapeHtml(settings['company.cnpj'] || settings['cnpj'] || ''),
    company_email: escapeHtml(settings['company.email'] || settings['email'] || ''),
    company_website: escapeHtml(settings['company.website'] || settings['website'] || ''),
    company_pix: escapeHtml(settings['company.pix'] || settings['pix'] || ''),
    company_bank: escapeHtml(settings['company.bank'] || settings['banco'] || ''),
    payment_conditions: escapeHtml(paymentConditions),
    portal_os_link: (() => {
      const portalUrl = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
      const slug = os.companies?.slug || 'pontualtech'
      const accessTk = createAccessToken(os.customer_id, os.company_id)
      return `${portalUrl}/portal/${slug}/os/${os.id}?access=${accessTk}`
    })(),
    // Discount vars (both recalculated and normal)
    subtotal: subtotal > 0 ? fmtCents(subtotal) : '',
    is_recalculado: isRecalculado ? 'true' : '',
    has_discount: hasDiscount ? 'true' : '',
    original_cost: hasRecalcDiscount ? fmtCents(originalCost) : (hasNormalDiscount ? fmtCents(subtotal) : ''),
    discount_amount: hasDiscount ? fmtCents(discountAmount) : '',
    discount_percent: hasDiscount ? `${discountPercent}%` : '',
    discount_section: hasDiscount ? `
      <div style="background:linear-gradient(135deg,#dcfce7,#bbf7d0);border:2px solid #22c55e;border-radius:14px;padding:20px;margin:0 0 20px;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:1px;">${isRecalculado ? 'Desconto Especial' : 'Desconto Aplicado'}</p>
        <p style="margin:0 0 8px;font-size:14px;color:#15803d;"><span style="text-decoration:line-through;color:#94a3b8;">${fmtCents(hasRecalcDiscount ? originalCost : subtotal)}</span> &rarr; <strong style="font-size:20px;color:#16a34a;">${fmtCents(totalCost)}</strong></p>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#16a34a;border-radius:20px;padding:6px 16px;">
          <p style="margin:0;font-size:14px;font-weight:800;color:#fff;">&#10003; ${discountPercent}% OFF</p>
        </td></tr></table>
      </div>` : '',
    recalculated_header: isRecalculado ? `
      <tr>
        <td style="padding:24px 28px 0;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td style="background:#fef3c7;border:2px solid #f59e0b;border-radius:24px;padding:10px 24px;">
                <p style="margin:0;font-size:13px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:1px;">&#9733; Nova Proposta Especial</p>
              </td>
            </tr>
          </table>
          <p style="margin:12px 0 0;font-size:14px;color:#64748b;line-height:1.6;">Analisamos seu caso e preparamos uma condicao diferenciada!</p>
        </td>
      </tr>` : '',
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

    const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
    const slug = os.companies?.slug || 'default'
    const token = generateOrcamentoToken(os.id)
    const approvalLink = `${portalBase}/portal/${slug}/orcamento/${os.id}?token=${token}`

    const { toTitleCase } = await import('@/lib/format-text')
    const vars = buildTemplateVars(os, settings, approvalLink, toTitleCase)
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

    // Detect if this is a recalculated quote
    const statusName = os.module_statuses?.name || ''
    const isRecalculado = /recalculad/i.test(statusName)

    // Load custom template — check for recalculated template first
    let msgTemplate = null
    if (isRecalculado) {
      msgTemplate = await prisma.messageTemplate.findFirst({
        where: { company_id: user.companyId, trigger: 'quote_recalculated_email', channel: 'email', is_active: true },
      })
    }
    if (!msgTemplate) {
      msgTemplate = await prisma.messageTemplate.findFirst({
        where: { company_id: user.companyId, trigger: 'quote_email', channel: 'email', is_active: true },
      })
    }
    const htmlTemplate = msgTemplate?.template || DEFAULT_QUOTE_TEMPLATE

    const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
    const slug = os.companies?.slug || 'default'
    const token = generateOrcamentoToken(os.id)
    const approvalLink = `${portalBase}/portal/${slug}/orcamento/${os.id}?token=${token}`

    const { toTitleCase } = await import('@/lib/format-text')
    const vars = buildTemplateVars(os, settings, approvalLink, toTitleCase)

    // For recalculated: inject discount section and header into template
    let finalTemplate = htmlTemplate
    if (isRecalculado && vars.recalculated_header) {
      // Insert recalculated header after status badge, and discount section before total
      finalTemplate = finalTemplate
        .replace('{{discount_section}}', vars.discount_section || '')
        .replace('{{recalculated_header}}', vars.recalculated_header || '')
    }
    const renderedHtml = replaceTemplateVars(finalTemplate, vars)

    const companyName = os.companies?.name || settings['company.name'] || 'Empresa'
    const osNumber = String(os.os_number).padStart(4, '0')
    const subject = isRecalculado
      ? `Nova Proposta Especial — OS-${osNumber} — ${companyName}`
      : `Orcamento OS-${osNumber} - ${companyName}`

    const sent = await sendCompanyEmail(user.companyId, recipientEmail, subject, renderedHtml)
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
