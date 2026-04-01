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

const PAGE_STYLE = `@page{size:A4;margin:12mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:11px;color:#333;line-height:1.4}.hdr{display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:12px}.hdr h1{font-size:16px}.hdr p{font-size:10px;color:#555}.badge{font-size:20px;font-weight:bold}.sec{margin-bottom:10px}.sec-t{font-size:10px;font-weight:700;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding-bottom:3px;margin-bottom:6px}.g2{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px}.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 12px}.f label{font-size:9px;font-weight:600;text-transform:uppercase;color:#888}.f p{font-size:11px;margin-top:1px}.fw{grid-column:1/-1}.sigs{display:flex;justify-content:space-between;margin-top:30px;padding-top:8px}.sig{width:45%;text-align:center;border-top:1px solid #333;padding-top:4px;font-size:10px;color:#555}.terms{margin-top:12px;padding:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;font-size:9px;color:#666}.terms h3{font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:3px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`

const PICKUP_TEMPLATE = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Coleta OS {{os_number}}</title><style>${PAGE_STYLE}</style></head><body>
<div class="hdr"><div><h1>{{company_name}}</h1><p>CNPJ: {{company_cnpj}} | Tel: {{company_phone}}</p><p>{{company_address}}</p></div><div style="text-align:right"><div class="badge">OS {{os_number}}</div><div style="font-size:10px;color:#555">{{today}}</div><div style="display:inline-block;padding:2px 8px;background:#dbeafe;border-radius:4px;font-size:10px;font-weight:600;color:#1e40af;margin-top:4px">COLETA</div></div></div>
<div class="sec"><div class="sec-t">Dados do Cliente</div><div class="g2"><div class="f"><label>Nome</label><p>{{customer_name}}</p></div><div class="f"><label>CPF/CNPJ</label><p>{{customer_document}}</p></div><div class="f"><label>Telefone</label><p>{{customer_phone}}</p></div><div class="f"><label>Email</label><p>{{customer_email}}</p></div><div class="f fw"><label>Endereco</label><p>{{customer_address}}</p></div></div></div>
<div class="sec"><div class="sec-t">Equipamento para Coleta</div><div class="g2"><div class="f"><label>Tipo</label><p>{{equipment_type}}</p></div><div class="f"><label>Marca / Modelo</label><p>{{equipment_brand}} {{equipment_model}}</p></div><div class="f"><label>N. Serie</label><p>{{serial_number}}</p></div></div></div>
<div class="sec"><div class="sec-t">Problema Relatado</div><p>{{reported_issue}}</p></div>
<div class="sec"><div class="sec-t">Observacoes do Motorista</div><div style="min-height:50px;border:1px solid #ddd;border-radius:4px;padding:6px"></div></div>
<div class="terms"><h3>Instrucoes</h3><p>1. Verificar se os cabos de energia e fontes acompanham o equipamento.</p><p>2. Equipamento pode ser enviado com toners/cartuchos instalados.</p><p>3. Este comprovante deve ser assinado pelo cliente no ato da coleta.</p></div>
<div class="sigs"><div class="sig">Motorista / Responsavel</div><div class="sig">Cliente</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`

const DELIVERY_REPAIR_TEMPLATE = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Entrega OS {{os_number}}</title><style>${PAGE_STYLE} .warranty-box{margin-top:12px;border:2px solid #16a34a;border-radius:6px;padding:10px;background:#f0fdf4} .warranty-box h3{color:#16a34a;font-size:11px;font-weight:700;margin-bottom:4px} .receipt-box{margin-top:12px;border:1px dashed #999;border-radius:4px;padding:10px;background:#fafafa} .receipt-box h3{font-size:10px;font-weight:700;margin-bottom:4px}</style></head><body>
<div class="hdr"><div><h1>{{company_name}}</h1><p>CNPJ: {{company_cnpj}} | Tel: {{company_phone}}</p><p>{{company_address}}</p></div><div style="text-align:right"><div class="badge">OS {{os_number}}</div><div style="font-size:10px;color:#555">{{today}}</div><div style="display:inline-block;padding:2px 8px;background:#dcfce7;border-radius:4px;font-size:10px;font-weight:600;color:#16a34a;margin-top:4px">ENTREGA REPARADO</div></div></div>
<div class="sec"><div class="sec-t">Cliente</div><div class="g3"><div class="f"><label>Nome</label><p>{{customer_name}}</p></div><div class="f"><label>CPF/CNPJ</label><p>{{customer_document}}</p></div><div class="f"><label>Telefone</label><p>{{customer_phone}}</p></div></div></div>
<div class="sec"><div class="sec-t">Equipamento</div><div class="g3"><div class="f"><label>Tipo</label><p>{{equipment_type}}</p></div><div class="f"><label>Marca / Modelo</label><p>{{equipment_brand}} {{equipment_model}}</p></div><div class="f"><label>N. Serie</label><p>{{serial_number}}</p></div></div></div>
<div class="sec"><div class="sec-t">Laudo Tecnico</div><p>{{diagnosis}}</p></div>
<div class="sec"><div class="sec-t">Servicos Realizados</div>{{items_table}}<div style="text-align:right;margin-top:6px"><strong style="font-size:14px">TOTAL: {{total_cost}}</strong></div></div>
<div class="sec"><div class="g2"><div class="f"><label>Forma de Pagamento</label><p>{{payment_method}}</p></div><div class="f"><label>Data Entrega</label><p>{{today}}</p></div></div></div>
<div class="warranty-box"><h3>TERMO DE GARANTIA — {{warranty_period}}</h3><p style="font-size:9px">Garantimos os servicos realizados nesta OS pelo prazo de {{warranty_period}} a partir desta data ({{today}}), conforme Art. 26 do CDC. A garantia cobre exclusivamente os servicos e pecas descritos acima. Nao cobre mau uso, quedas, sobrecarga eletrica ou intervencao de terceiros. Para acionar a garantia, entre em contato: {{company_phone}}.</p></div>
<div class="receipt-box"><h3>RECIBO DE ENTREGA</h3><p style="font-size:9px">Declaro que recebi o equipamento {{equipment_full}} (OS {{os_number}}) em perfeito funcionamento, conforme servicos descritos acima, no valor de {{total_cost}}.</p></div>
<div class="sigs"><div class="sig">{{company_name}}</div><div class="sig">Cliente: {{customer_name}}</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`

const DELIVERY_NOREPAIR_TEMPLATE = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Devolucao OS {{os_number}}</title><style>${PAGE_STYLE}</style></head><body>
<div class="hdr"><div><h1>{{company_name}}</h1><p>CNPJ: {{company_cnpj}} | Tel: {{company_phone}}</p><p>{{company_address}}</p></div><div style="text-align:right"><div class="badge">OS {{os_number}}</div><div style="font-size:10px;color:#555">{{today}}</div><div style="display:inline-block;padding:2px 8px;background:#fef3c7;border-radius:4px;font-size:10px;font-weight:600;color:#92400e;margin-top:4px">DEVOLUCAO SEM REPARO</div></div></div>
<div class="sec"><div class="sec-t">Cliente</div><div class="g3"><div class="f"><label>Nome</label><p>{{customer_name}}</p></div><div class="f"><label>CPF/CNPJ</label><p>{{customer_document}}</p></div><div class="f"><label>Telefone</label><p>{{customer_phone}}</p></div></div></div>
<div class="sec"><div class="sec-t">Equipamento</div><div class="g3"><div class="f"><label>Tipo</label><p>{{equipment_type}}</p></div><div class="f"><label>Marca / Modelo</label><p>{{equipment_brand}} {{equipment_model}}</p></div><div class="f"><label>N. Serie</label><p>{{serial_number}}</p></div></div></div>
<div class="sec"><div class="sec-t">Problema Relatado</div><p>{{reported_issue}}</p></div>
<div class="sec"><div class="sec-t">Laudo Tecnico</div><p>{{diagnosis}}</p></div>
<div class="sec" style="background:#fef3c7;border:1px solid #fde68a;border-radius:4px;padding:8px"><p style="font-size:10px;color:#92400e"><strong>MOTIVO DA DEVOLUCAO SEM REPARO:</strong> Orcamento nao aprovado pelo cliente ou reparo inviavel.</p><p style="font-size:10px;color:#92400e;margin-top:4px">O equipamento esta sendo devolvido nas mesmas condicoes em que foi recebido.</p></div>
<div class="terms"><h3>Observacoes</h3><p>1. Equipamento devolvido sem reparo, conforme decisao do cliente.</p><p>2. Nao ha cobranca de taxa de diagnostico para este servico.</p><p>3. Caso deseje reavaliar o orcamento, entre em contato: {{company_phone}}.</p></div>
<div class="sigs"><div class="sig">{{company_name}}</div><div class="sig">Cliente: {{customer_name}}</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`

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

    const template = req.nextUrl.searchParams.get('template') || 'os_full'
    const companyName = company?.name || settingsMap['company.name'] || 'PontualTech'
    const companyPhone = settingsMap['company.phone'] || settingsMap['telefone'] || '—'
    const companyEmail = settingsMap['company.email'] || settingsMap['email'] || '—'
    const companyCnpj = settingsMap['company.cnpj'] || settingsMap['cnpj'] || '—'
    const osNum = String(os.os_number)
    const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')
    const warrantyPeriod = settingsMap['quote.warranty'] || '90 dias'
    const today = new Date().toLocaleDateString('pt-BR')

    const vars: Record<string, string> = {
      os_number: osNum,
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
      company_name: companyName,
      company_phone: companyPhone,
      company_email: companyEmail,
      company_address: companyAddress,
      company_cnpj: companyCnpj,
      equipment_full: equipment,
      warranty_period: warrantyPeriod,
      today,
      payment_method: os.payment_method || '—',
    }

    // Selecionar template
    let finalHtml = ''

    if (template === 'os_pickup') {
      finalHtml = replaceTemplateVars(PICKUP_TEMPLATE, vars)
    } else if (template === 'os_delivery_repair') {
      finalHtml = replaceTemplateVars(DELIVERY_REPAIR_TEMPLATE, vars)
    } else if (template === 'os_delivery_norepair') {
      finalHtml = replaceTemplateVars(DELIVERY_NOREPAIR_TEMPLATE, vars)
    } else {
      // Default: os_full
      const dbTemplate = await prisma.printTemplate.findFirst({
        where: { company_id: user.companyId, type: 'os', is_default: true, is_active: true },
      })
      finalHtml = replaceTemplateVars(dbTemplate?.html_template || DEFAULT_OS_TEMPLATE, vars)
      if (dbTemplate?.css_override) {
        finalHtml = finalHtml.replace('</head>', `<style>${dbTemplate.css_override}</style></head>`)
      }
    }

    return new NextResponse(finalHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    return handleError(err)
  }
}
