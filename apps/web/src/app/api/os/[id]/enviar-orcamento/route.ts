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
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td colspan="4" style="padding:10px 12px;background:#2563eb;color:#fff;font-weight:700;font-size:14px;border-radius:6px 6px 0 0;">
          &#128295; Servicos Tecnicos
        </td>
      </tr>
      <tr style="background:#f1f5f9;">
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">Descricao</td>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:center;width:50px;">Qtd</td>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:right;width:90px;">Unit.</td>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:right;width:100px;">Subtotal</td>
      </tr>`
    for (const item of servicos) {
      html += `<tr>
        <td style="padding:10px 12px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${item.description || '—'}</td>
        <td style="padding:10px 12px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;text-align:center;">${item.quantity}</td>
        <td style="padding:10px 12px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtCents(item.unit_price)}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtCents(item.total_price)}</td>
      </tr>`
    }
    html += `</table>`
  }

  if (pecas.length > 0) {
    html += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td colspan="4" style="padding:10px 12px;background:#7c3aed;color:#fff;font-weight:700;font-size:14px;border-radius:6px 6px 0 0;">
          &#128230; Pecas e Componentes
        </td>
      </tr>
      <tr style="background:#f1f5f9;">
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;">Descricao</td>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:center;width:50px;">Qtd</td>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:right;width:90px;">Unit.</td>
        <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:right;width:100px;">Subtotal</td>
      </tr>`
    for (const item of pecas) {
      html += `<tr>
        <td style="padding:10px 12px;font-size:13px;color:#1e293b;border-bottom:1px solid #f1f5f9;">${item.description || '—'}</td>
        <td style="padding:10px 12px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;text-align:center;">${item.quantity}</td>
        <td style="padding:10px 12px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtCents(item.unit_price)}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtCents(item.total_price)}</td>
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
  <title>Orcamento - {{company_name}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb 0%,#1e40af 100%);padding:32px 24px;text-align:center;">
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:22px;font-weight:700;">{{company_name}}</h1>
              <p style="margin:0;color:#bfdbfe;font-size:15px;font-weight:600;">&#128203; DIAGNOSTICO CONCLUIDO</p>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:28px 24px 0;">
              <!-- Greeting -->
              <p style="margin:0 0 16px;font-size:16px;color:#1e293b;">
                &#128075; Ola <strong>{{customer_name}}</strong>,
              </p>
              <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">
                Otima noticia! Nossos tecnicos finalizaram o laudo do seu equipamento
                <strong>{{equipment}}</strong> (OS #{{os_number}}) e temos a solucao completa para voce.
              </p>

              <!-- Laudo tecnico -->
              {{laudo_section}}

              <!-- Eco tip -->
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
                <p style="margin:0;font-size:13px;color:#166534;line-height:1.5;">
                  &#128161; <strong>Voce sabia?</strong> Reparar seu equipamento custa ate 70% menos do que comprar um novo e ainda ajuda a reduzir o lixo eletronico. Escolha inteligente e sustentavel!
                </p>
              </div>

              <!-- Items table -->
              {{items_table}}

              <!-- Installment info (DESTAQUE) -->
              <div style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:10px;padding:24px;margin-bottom:16px;text-align:center;">
                <p style="margin:0 0 6px;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                  &#128179; {{installment_info}}
                </p>
                <p style="margin:0;font-size:14px;color:#bfdbfe;">
                  Valor total: {{total_cost}}
                </p>
              </div>

              <!-- Execution time -->
              <p style="margin:0 0 8px;font-size:14px;color:#475569;text-align:center;">
                &#128197; <strong>Prazo de execucao:</strong> {{execution_days}} apos aprovacao
              </p>

              <!-- Warranty -->
              <p style="margin:0 0 8px;font-size:14px;color:#475569;text-align:center;">
                &#128737;&#65039; <strong>Garantia de {{warranty_period}}</strong> em todos os servicos realizados.
              </p>

              <!-- Eco message -->
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin:20px 0;text-align:center;">
                <p style="margin:0;font-size:13px;color:#166534;line-height:1.5;">
                  &#127793; Ao reparar, voce economiza dinheiro e ajuda o planeta. Cada equipamento consertado e menos lixo eletronico no meio ambiente.
                </p>
              </div>

              <!-- Validity -->
              <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:24px;text-align:center;">
                <p style="margin:0;font-size:14px;color:#92400e;font-weight:700;">
                  &#9200; ORCAMENTO VALIDO POR {{quote_validity}}
                </p>
              </div>

              <!-- CTA Button -->
              <div style="text-align:center;margin-bottom:20px;">
                <a href="{{approval_link}}" target="_blank"
                   style="display:inline-block;background:#22c55e;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 40px;border-radius:8px;letter-spacing:0.5px;">
                  &#9989; APROVAR MEU ORCAMENTO AGORA
                </a>
              </div>

              <!-- WhatsApp -->
              <div style="text-align:center;margin-bottom:28px;">
                <p style="margin:0 0 8px;font-size:13px;color:#64748b;">&#128241; Prefere falar com a gente?</p>
                <a href="https://wa.me/{{company_whatsapp}}" target="_blank"
                   style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 24px;border-radius:6px;">
                  &#128172; Chamar no WhatsApp
                </a>
              </div>

              <!-- Conditions -->
              <div style="border-top:2px solid #e2e8f0;padding-top:20px;margin-bottom:20px;">
                <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b;font-weight:700;">Condicoes</h3>
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#475569;">
                  <tr>
                    <td style="padding:6px 0;font-weight:600;width:140px;vertical-align:top;">Pagamento:</td>
                    <td style="padding:6px 0;">{{payment_conditions}}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-weight:600;vertical-align:top;">Prazo execucao:</td>
                    <td style="padding:6px 0;">{{execution_days}} apos aprovacao</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-weight:600;vertical-align:top;">Garantia:</td>
                    <td style="padding:6px 0;">{{warranty_period}} em servicos realizados</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-weight:600;vertical-align:top;">Validade:</td>
                    <td style="padding:6px 0;">{{quote_validity}}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-weight:600;vertical-align:top;">PIX:</td>
                    <td style="padding:6px 0;">{{company_pix}}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-weight:600;vertical-align:top;">Banco:</td>
                    <td style="padding:6px 0;">{{company_bank}}</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 24px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1e293b;">{{company_name}}</p>
              <p style="margin:0 0 4px;font-size:12px;color:#64748b;">{{company_address}}</p>
              <p style="margin:0 0 4px;font-size:12px;color:#64748b;">CNPJ: {{company_cnpj}}</p>
              <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Tel: {{company_phone}} | {{company_email}}</p>
              <p style="margin:0;font-size:12px;color:#64748b;">{{company_website}}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

async function loadOSData(osId: string, companyId: string) {
  const os = await prisma.serviceOrder.findFirst({
    where: { id: osId, company_id: companyId, deleted_at: null },
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
  const quoteValidity = settings['quote.validity'] || '2 dias'
  const paymentConditions = settings['quote.payment_conditions'] || 'PIX, Dinheiro, Cartao de credito (ate 3x sem juros), Cartao de debito'
  const whatsapp = (settings['company.whatsapp'] || settings['whatsapp'] || settings['company.phone'] || '').replace(/\D/g, '')

  const items = os.service_order_items || []
  const itemsTable = buildItemsTable(items)

  const laudo = os.diagnosis || ''
  const laudoSection = laudo
    ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:13px;color:#92400e;font-weight:600;">LAUDO TECNICO</p>
        <p style="margin:0 0 8px;font-size:14px;color:#78350f;"><strong>Problema relatado:</strong> ${os.reported_issue || '—'}</p>
        <p style="margin:0;font-size:14px;color:#78350f;"><strong>Laudo:</strong> ${laudo}</p>
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
