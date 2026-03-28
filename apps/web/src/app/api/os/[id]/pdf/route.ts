import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

const DEFAULT_OS_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>OS-{{os_number}} - {{company_name}}</title>
<style>
@page { size: A4; margin: 15mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #333; line-height: 1.4; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 12px; margin-bottom: 16px; }
.company-info h1 { font-size: 20px; margin-bottom: 4px; }
.company-info p { font-size: 11px; color: #555; }
.os-badge { text-align: right; }
.os-badge .os-num { font-size: 24px; font-weight: bold; }
.os-badge .os-date { font-size: 11px; color: #555; margin-top: 4px; }
.os-badge .os-status { display: inline-block; padding: 3px 10px; background: #e5e7eb; border-radius: 4px; font-size: 11px; font-weight: 600; margin-top: 6px; }
.section { margin-bottom: 14px; }
.section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 16px; }
.field label { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #888; }
.field p { font-size: 12px; margin-top: 1px; }
.full-width { grid-column: 1 / -1; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
table th { background: #f3f4f6; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; color: #555; border-bottom: 2px solid #ddd; }
table td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
table td.right, table th.right { text-align: right; }
.totals { margin-top: 10px; text-align: right; }
.totals .line { display: flex; justify-content: flex-end; gap: 20px; padding: 3px 0; font-size: 12px; }
.totals .line.total { font-size: 16px; font-weight: bold; border-top: 2px solid #333; padding-top: 8px; margin-top: 4px; }
.terms { margin-top: 20px; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 10px; color: #666; }
.terms h3 { font-size: 10px; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
.signatures { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 10px; }
.sig-line { width: 45%; text-align: center; }
.sig-line .line { border-top: 1px solid #333; padding-top: 6px; font-size: 11px; color: #555; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
}
</style>
</head>
<body>
<div class="header">
  <div class="company-info">
    <h1>{{company_name}}</h1>
    <p>CNPJ: {{company_cnpj}}</p>
    <p>{{company_address}}</p>
    <p>Tel: {{company_phone}} | {{company_email}}</p>
  </div>
  <div class="os-badge">
    <div class="os-num">OS-{{os_number}}</div>
    <div class="os-date">{{created_at}}</div>
    <div class="os-status">{{status}}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Dados do Cliente</div>
  <div class="grid">
    <div class="field"><label>Nome</label><p>{{customer_name}}</p></div>
    <div class="field"><label>CPF/CNPJ</label><p>{{customer_document}}</p></div>
    <div class="field"><label>Telefone</label><p>{{customer_phone}}</p></div>
    <div class="field"><label>Email</label><p>{{customer_email}}</p></div>
    <div class="field full-width"><label>Endereco</label><p>{{customer_address}}</p></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Equipamento</div>
  <div class="grid">
    <div class="field"><label>Tipo</label><p>{{equipment_type}}</p></div>
    <div class="field"><label>Marca</label><p>{{equipment_brand}}</p></div>
    <div class="field"><label>Modelo</label><p>{{equipment_model}}</p></div>
    <div class="field"><label>N. Serie</label><p>{{serial_number}}</p></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Problema Relatado</div>
  <p style="font-size:12px;min-height:30px;">{{reported_issue}}</p>
</div>

<div class="section">
  <div class="section-title">Diagnostico</div>
  <p style="font-size:12px;min-height:30px;">{{diagnosis}}</p>
</div>

<div class="section">
  <div class="section-title">Itens / Orcamento</div>
  {{items_table}}
  <div class="totals">
    <div class="line"><span>Pecas:</span><span>{{total_parts}}</span></div>
    <div class="line"><span>Servicos:</span><span>{{total_services}}</span></div>
    <div class="line total"><span>TOTAL:</span><span>{{total_cost}}</span></div>
  </div>
</div>

<div class="terms">
  <h3>Termos e Condicoes</h3>
  <p>1. O prazo de garantia dos servicos prestados e de 90 (noventa) dias, conforme Art. 26 do CDC.</p>
  <p>2. Equipamentos nao retirados em ate 90 dias apos a conclusao serao considerados abandonados.</p>
  <p>3. A empresa nao se responsabiliza por dados armazenados no equipamento.</p>
  <p>4. O orcamento tem validade de 15 dias a partir da data de emissao.</p>
</div>

<div class="signatures">
  <div class="sig-line">
    <div class="line">Responsavel pela Recepcao</div>
  </div>
  <div class="sig-line">
    <div class="line">Cliente / Responsavel pela Entrega</div>
  </div>
</div>

<script>window.onload = function() { window.print(); }</script>
</body>
</html>`

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(date: Date | string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('pt-BR')
}

function buildItemsTable(items: Array<{
  description: string | null
  item_type: string
  quantity: number
  unit_price: number
  total_price: number
}>): string {
  if (!items || items.length === 0) {
    return '<p style="font-size:11px;color:#888;text-align:center;padding:16px 0;">Nenhum item</p>'
  }

  let html = `<table>
    <thead><tr>
      <th>Tipo</th>
      <th>Descricao</th>
      <th class="right">Qtd</th>
      <th class="right">Valor Unit.</th>
      <th class="right">Total</th>
    </tr></thead><tbody>`

  for (const item of items) {
    const tipo = item.item_type === 'PECA' ? 'Peca' : 'Servico'
    html += `<tr>
      <td>${tipo}</td>
      <td>${item.description || '—'}</td>
      <td class="right">${item.quantity}</td>
      <td class="right">${fmtCents(item.unit_price)}</td>
      <td class="right">${fmtCents(item.total_price)}</td>
    </tr>`
  }

  html += '</tbody></table>'
  return html
}

function replaceTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '—')
  }
  return result
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Load OS with customer and items
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: true,
        service_order_items: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } },
        module_statuses: true,
      },
    })

    if (!os) return error('OS nao encontrada', 404)

    // Load company
    const company = await prisma.company.findFirst({
      where: { id: user.companyId },
    })

    // Load company settings for address/phone/email
    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId },
    })
    const settingsMap: Record<string, string> = {}
    for (const s of settings) {
      settingsMap[s.key] = s.value
    }

    // Load default OS print template
    const printTemplate = await prisma.printTemplate.findFirst({
      where: { company_id: user.companyId, type: 'os', is_default: true, is_active: true },
    })

    const htmlTemplate = printTemplate?.html_template || DEFAULT_OS_TEMPLATE

    // Build customer address
    const c = os.customers
    const customerAddress = c
      ? [c.address_street, c.address_number, c.address_complement, c.address_neighborhood, c.address_city, c.address_state, c.address_zip]
          .filter(Boolean)
          .join(', ')
      : '—'

    // Build company address from settings
    const companyAddress = settingsMap['company.address'] ||
      settingsMap['endereco'] ||
      [settingsMap['company.street'], settingsMap['company.number'], settingsMap['company.city'], settingsMap['company.state']]
        .filter(Boolean)
        .join(', ') || '—'

    const vars: Record<string, string> = {
      os_number: String(os.os_number).padStart(4, '0'),
      customer_name: c?.legal_name || '—',
      customer_document: c?.document_number || '—',
      customer_phone: c?.mobile || c?.phone || '—',
      customer_email: c?.email || '—',
      customer_address: customerAddress,
      equipment_type: os.equipment_type || '—',
      equipment_brand: os.equipment_brand || '—',
      equipment_model: os.equipment_model || '—',
      serial_number: os.serial_number || '—',
      reported_issue: os.reported_issue || '—',
      diagnosis: os.diagnosis || '—',
      items_table: buildItemsTable(os.service_order_items),
      total_parts: fmtCents(os.total_parts ?? 0),
      total_services: fmtCents(os.total_services ?? 0),
      total_cost: fmtCents(os.total_cost ?? 0),
      status: os.module_statuses?.name || '—',
      created_at: fmtDate(os.created_at),
      company_name: company?.name || settingsMap['company.name'] || 'PontualTech',
      company_phone: settingsMap['company.phone'] || settingsMap['telefone'] || '—',
      company_email: settingsMap['company.email'] || settingsMap['email'] || '—',
      company_address: companyAddress,
      company_cnpj: settingsMap['company.cnpj'] || settingsMap['cnpj'] || '—',
    }

    const html = replaceTemplateVars(htmlTemplate, vars)

    // Add CSS override if exists
    let finalHtml = html
    if (printTemplate?.css_override) {
      finalHtml = html.replace('</head>', `<style>${printTemplate.css_override}</style></head>`)
    }

    return new NextResponse(finalHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
