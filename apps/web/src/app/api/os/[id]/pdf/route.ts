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
@page { size: A4; margin: 12mm 15mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #222; line-height: 1.4; }
.header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #222; padding-bottom: 12px; margin-bottom: 14px; }
.company-info { max-width: 65%; }
.company-info h1 { font-size: 20px; font-weight: 800; margin-bottom: 2px; letter-spacing: -0.3px; }
.company-info .subtitle { font-size: 10px; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.company-info p { font-size: 10px; color: #555; line-height: 1.5; }
.os-badge { text-align: right; }
.os-badge .os-num { font-size: 28px; font-weight: 900; letter-spacing: -0.5px; }
.os-badge .os-date { font-size: 10px; color: #555; margin-top: 4px; }
.os-badge .os-status { display: inline-block; padding: 4px 12px; background: #222; color: #fff; border-radius: 4px; font-size: 10px; font-weight: 700; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.section { margin-bottom: 12px; }
.section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #222; border-bottom: 2px solid #ddd; padding-bottom: 4px; margin-bottom: 8px; letter-spacing: 0.8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 16px; }
.grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px 12px; }
.field label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.3px; }
.field p { font-size: 11px; margin-top: 1px; font-weight: 500; }
.full-width { grid-column: 1 / -1; }
.text-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px; padding: 8px 10px; font-size: 11px; min-height: 28px; line-height: 1.5; }
table { width: 100%; border-collapse: collapse; margin-top: 6px; }
table th { background: #f0f0f0; text-align: left; padding: 7px 8px; font-size: 9px; font-weight: 800; text-transform: uppercase; color: #444; border: 1px solid #ddd; letter-spacing: 0.3px; }
table td { padding: 6px 8px; border: 1px solid #e0e0e0; font-size: 10px; }
table tr:nth-child(even) td { background: #fafafa; }
table td.right, table th.right { text-align: right; }
.totals { margin-top: 8px; text-align: right; }
.totals .line { display: flex; justify-content: flex-end; gap: 20px; padding: 3px 0; font-size: 11px; color: #555; }
.totals .line.total { font-size: 16px; font-weight: 900; color: #222; border-top: 3px solid #222; padding-top: 8px; margin-top: 4px; }
.payment { margin-top: 6px; font-size: 11px; }
.payment strong { font-weight: 700; }
.terms { margin-top: 14px; padding: 10px 12px; background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px; font-size: 9px; color: #666; line-height: 1.6; }
.terms h3 { font-size: 9px; font-weight: 800; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; color: #444; }
.signatures { display: flex; justify-content: space-between; margin-top: 36px; }
.sig-line { width: 44%; text-align: center; }
.sig-line .line { border-top: 1px solid #333; padding-top: 6px; font-size: 10px; color: #555; font-weight: 600; }
.sig-label { font-size: 9px; color: #888; margin-top: 2px; }
.footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd; text-align: center; font-size: 9px; color: #888; }
.footer strong { color: #555; }
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
    <p class="subtitle">Assistencia Tecnica em Informatica</p>
    <p>CNPJ: {{company_cnpj}}</p>
    <p>{{company_address}}</p>
    <p>Tel: {{company_phone}} | {{company_email}}</p>
  </div>
  <div class="os-badge">
    <div class="os-num">OS {{os_number}}</div>
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
  <div class="grid-4">
    <div class="field"><label>Tipo</label><p>{{equipment_type}}</p></div>
    <div class="field"><label>Marca</label><p>{{equipment_brand}}</p></div>
    <div class="field"><label>Modelo</label><p>{{equipment_model}}</p></div>
    <div class="field"><label>N. Serie</label><p>{{serial_number}}</p></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Problema Relatado</div>
  <div class="text-box">{{reported_issue}}</div>
</div>

<div class="section">
  <div class="section-title">Diagnostico / Laudo</div>
  <div class="text-box">{{diagnosis}}</div>
</div>

<div class="section">
  <div class="section-title">Itens / Orcamento</div>
  {{items_table}}
  <div class="totals">
    <div class="line"><span>Pecas:</span><span>{{total_parts}}</span></div>
    <div class="line"><span>Servicos:</span><span>{{total_services}}</span></div>
    <div class="line total"><span>TOTAL:</span><span>{{total_cost}}</span></div>
  </div>
  <div class="payment"><strong>Forma de pagamento:</strong> {{payment_method}}</div>
</div>

<div class="terms">
  <h3>Termos e Condicoes</h3>
  <p>1. O prazo de garantia dos servicos prestados e de 90 (noventa) dias, conforme Art. 26 do CDC.</p>
  <p>2. Equipamentos nao retirados em ate 90 dias apos a conclusao serao considerados abandonados, conforme Art. 1.275 do Codigo Civil.</p>
  <p>3. A empresa nao se responsabiliza por dados armazenados no equipamento. Recomendamos backup previo.</p>
  <p>4. O orcamento tem validade de 15 dias a partir da data de emissao.</p>
</div>

<div class="signatures">
  <div class="sig-line">
    <div class="line">Assinatura do Tecnico</div>
    <p class="sig-label">{{company_name}}</p>
  </div>
  <div class="sig-line">
    <div class="line">Assinatura do Cliente</div>
    <p class="sig-label">{{customer_name}}</p>
  </div>
</div>

<div class="footer">
  <strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}
</div>

<script>window.onload = function() { window.print(); }</script>
</body>
</html>`

const PAGE_STYLE = `@page{size:A4;margin:12mm 15mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#222;line-height:1.4}.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #222;padding-bottom:10px;margin-bottom:14px}.hdr .co{max-width:65%}.hdr h1{font-size:18px;font-weight:800;letter-spacing:-0.3px;margin-bottom:1px}.hdr .co-sub{font-size:9px;color:#555;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px}.hdr p{font-size:10px;color:#555;line-height:1.5}.badge{font-size:24px;font-weight:900;letter-spacing:-0.3px}.sec{margin-bottom:12px}.sec-t{font-size:10px;font-weight:800;text-transform:uppercase;color:#222;border-bottom:2px solid #ddd;padding-bottom:3px;margin-bottom:7px;letter-spacing:0.8px}.g2{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px}.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px 14px}.f label{font-size:9px;font-weight:700;text-transform:uppercase;color:#888;letter-spacing:0.3px}.f p{font-size:11px;margin-top:1px;font-weight:500}.fw{grid-column:1/-1}.text-box{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;padding:8px 10px;font-size:11px;min-height:24px;line-height:1.5}table{width:100%;border-collapse:collapse;margin-top:4px}table th{background:#f0f0f0;text-align:left;padding:6px 8px;font-size:9px;font-weight:800;text-transform:uppercase;color:#444;border:1px solid #ddd;letter-spacing:0.3px}table td{padding:6px 8px;border:1px solid #e0e0e0;font-size:10px}table tr:nth-child(even) td{background:#fafafa}table td.right,table th.right{text-align:right}.sigs{display:flex;justify-content:space-between;margin-top:32px}.sig{width:44%;text-align:center;border-top:1px solid #333;padding-top:5px;font-size:10px;color:#555;font-weight:600}.sig-sub{font-size:9px;color:#888;margin-top:2px;font-weight:400}.terms{margin-top:14px;padding:10px 12px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:4px;font-size:9px;color:#666;line-height:1.6}.terms h3{font-size:9px;font-weight:800;text-transform:uppercase;margin-bottom:3px;letter-spacing:0.5px;color:#444}.footer{margin-top:14px;padding-top:8px;border-top:1px solid #ddd;text-align:center;font-size:9px;color:#888}.footer strong{color:#555}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`

const PICKUP_TEMPLATE = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Coleta OS {{os_number}}</title><style>${PAGE_STYLE}</style></head><body>
<div class="hdr"><div class="co"><h1>{{company_name}}</h1><p class="co-sub">Assistencia Tecnica em Informatica</p><p>CNPJ: {{company_cnpj}}</p><p>{{company_address}}</p><p>Tel: {{company_phone}} | {{company_email}}</p></div><div style="text-align:right"><div class="badge">OS {{os_number}}</div><div style="font-size:10px;color:#555">{{today}}</div><div style="display:inline-block;padding:4px 12px;background:#222;color:#fff;border-radius:4px;font-size:10px;font-weight:700;margin-top:6px;text-transform:uppercase;letter-spacing:0.5px">COLETA</div></div></div>
<div class="sec"><div class="sec-t">Dados do Cliente</div><div class="g2"><div class="f"><label>Nome</label><p>{{customer_name}}</p></div><div class="f"><label>CPF/CNPJ</label><p>{{customer_document}}</p></div><div class="f"><label>Telefone</label><p>{{customer_phone}}</p></div><div class="f"><label>Email</label><p>{{customer_email}}</p></div><div class="f fw"><label>Endereco</label><p>{{customer_address}}</p></div></div></div>
<div class="sec"><div class="sec-t">Equipamento para Coleta</div><div class="g3"><div class="f"><label>Tipo</label><p>{{equipment_type}}</p></div><div class="f"><label>Marca / Modelo</label><p>{{equipment_brand}} {{equipment_model}}</p></div><div class="f"><label>N. Serie</label><p>{{serial_number}}</p></div></div></div>
<div class="sec"><div class="sec-t">Problema Relatado</div><div class="text-box">{{reported_issue}}</div></div>
<div class="sec"><div class="sec-t">Observacoes do Motorista</div><div style="min-height:60px;border:1px solid #ddd;border-radius:4px;padding:8px"></div></div>
<div class="terms"><h3>Instrucoes de Coleta</h3><p>1. Verificar se os cabos de energia e fontes acompanham o equipamento.</p><p>2. Equipamento pode ser enviado com toners/cartuchos instalados.</p><p>3. Este comprovante deve ser assinado pelo cliente no ato da coleta.</p><p>4. Qualquer avaria visivel deve ser anotada nas observacoes acima.</p></div>
<div class="terms" style="margin-top:10px;background:#f0f9ff;border:1px solid #bae6fd"><h3>Acompanhe sua OS Online</h3><p>Acesse: <strong>{{portal_url}}</strong></p><p>Faca login com seu CPF/CNPJ e a senha cadastrada. Pelo portal voce pode consultar o status da OS, aprovar orcamentos e abrir novas solicitacoes.</p><p>WhatsApp Suporte: <strong>{{whatsapp_suporte}}</strong></p></div>
<div class="sigs"><div class="sig">Motorista / Responsavel<p class="sig-sub">{{company_name}}</p></div><div class="sig">Assinatura do Cliente<p class="sig-sub">{{customer_name}}</p></div></div>
<div class="footer"><strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}</div>
<script>window.onload=function(){window.print()}</script></body></html>`

const DELIVERY_REPAIR_TEMPLATE = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Entrega OS {{os_number}}</title><style>${PAGE_STYLE} .warranty-box{margin-top:14px;border:2px solid #333;border-radius:6px;padding:12px;background:#f8f8f8} .warranty-box h3{font-size:10px;font-weight:800;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px} .receipt-box{margin-top:14px;border:2px dashed #888;border-radius:4px;padding:12px;background:#fafafa} .receipt-box h3{font-size:10px;font-weight:800;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px}</style></head><body>
<div class="hdr"><div class="co"><h1>{{company_name}}</h1><p class="co-sub">Assistencia Tecnica em Informatica</p><p>CNPJ: {{company_cnpj}}</p><p>{{company_address}}</p><p>Tel: {{company_phone}} | {{company_email}}</p></div><div style="text-align:right"><div class="badge">OS {{os_number}}</div><div style="font-size:10px;color:#555">{{today}}</div><div style="display:inline-block;padding:4px 12px;background:#222;color:#fff;border-radius:4px;font-size:10px;font-weight:700;margin-top:6px;text-transform:uppercase;letter-spacing:0.5px">ENTREGA REPARADO</div></div></div>
<div class="sec"><div class="sec-t">Dados do Cliente</div><div class="g3"><div class="f"><label>Nome</label><p>{{customer_name}}</p></div><div class="f"><label>CPF/CNPJ</label><p>{{customer_document}}</p></div><div class="f"><label>Telefone</label><p>{{customer_phone}}</p></div></div></div>
<div class="sec"><div class="sec-t">Equipamento</div><div class="g3"><div class="f"><label>Tipo</label><p>{{equipment_type}}</p></div><div class="f"><label>Marca / Modelo</label><p>{{equipment_brand}} {{equipment_model}}</p></div><div class="f"><label>N. Serie</label><p>{{serial_number}}</p></div></div></div>
<div class="sec"><div class="sec-t">Laudo Tecnico</div><div class="text-box">{{diagnosis}}</div></div>
<div class="sec"><div class="sec-t">Servicos Realizados</div>{{items_table}}<div style="text-align:right;margin-top:8px"><strong style="font-size:16px;font-weight:900">TOTAL: {{total_cost}}</strong></div></div>
<div class="sec"><div class="g2"><div class="f"><label>Forma de Pagamento</label><p><strong>{{payment_method}}</strong></p></div><div class="f"><label>Data Entrega</label><p><strong>{{today}}</strong></p></div></div></div>
<div class="warranty-box"><h3>Termo de Garantia — {{warranty_period}}</h3><p style="font-size:9px;line-height:1.6">Garantimos os servicos realizados nesta OS pelo prazo de {{warranty_period}} a partir desta data ({{today}}), conforme Art. 26 do CDC. A garantia cobre exclusivamente os servicos e pecas descritos acima. Nao cobre mau uso, quedas, sobrecarga eletrica ou intervencao de terceiros. Para acionar a garantia, entre em contato: {{company_phone}}.</p></div>
<div class="receipt-box"><h3>Recibo de Entrega</h3><p style="font-size:9px;line-height:1.6">Declaro que recebi o equipamento {{equipment_full}} (OS {{os_number}}) em perfeito funcionamento, conforme servicos descritos acima, no valor de {{total_cost}}.</p></div>
<div class="terms" style="margin-top:10px;background:#f0f9ff;border:1px solid #bae6fd"><h3>Acompanhe suas OS Online</h3><p>Acesse: <strong>{{portal_url}}</strong></p><p>Faca login com seu CPF/CNPJ e a senha cadastrada. Consulte status, historico e abra novas solicitacoes.</p><p>WhatsApp Suporte: <strong>{{whatsapp_suporte}}</strong></p></div>
<div class="sigs"><div class="sig">Assinatura do Tecnico<p class="sig-sub">{{company_name}}</p></div><div class="sig">Assinatura do Cliente<p class="sig-sub">{{customer_name}}</p></div></div>
<div class="footer"><strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}</div>
<script>window.onload=function(){window.print()}</script></body></html>`

const DELIVERY_NOREPAIR_TEMPLATE = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Devolucao OS {{os_number}}</title><style>${PAGE_STYLE}</style></head><body>
<div class="hdr"><div class="co"><h1>{{company_name}}</h1><p class="co-sub">Assistencia Tecnica em Informatica</p><p>CNPJ: {{company_cnpj}}</p><p>{{company_address}}</p><p>Tel: {{company_phone}} | {{company_email}}</p></div><div style="text-align:right"><div class="badge">OS {{os_number}}</div><div style="font-size:10px;color:#555">{{today}}</div><div style="display:inline-block;padding:4px 12px;background:#222;color:#fff;border-radius:4px;font-size:10px;font-weight:700;margin-top:6px;text-transform:uppercase;letter-spacing:0.5px">DEVOLUCAO SEM REPARO</div></div></div>
<div class="sec"><div class="sec-t">Dados do Cliente</div><div class="g3"><div class="f"><label>Nome</label><p>{{customer_name}}</p></div><div class="f"><label>CPF/CNPJ</label><p>{{customer_document}}</p></div><div class="f"><label>Telefone</label><p>{{customer_phone}}</p></div></div></div>
<div class="sec"><div class="sec-t">Equipamento</div><div class="g3"><div class="f"><label>Tipo</label><p>{{equipment_type}}</p></div><div class="f"><label>Marca / Modelo</label><p>{{equipment_brand}} {{equipment_model}}</p></div><div class="f"><label>N. Serie</label><p>{{serial_number}}</p></div></div></div>
<div class="sec"><div class="sec-t">Problema Relatado</div><div class="text-box">{{reported_issue}}</div></div>
<div class="sec"><div class="sec-t">Laudo Tecnico</div><div class="text-box">{{diagnosis}}</div></div>
<div class="sec" style="background:#f8f8f8;border:2px solid #888;border-radius:4px;padding:10px"><p style="font-size:10px;color:#333"><strong>MOTIVO DA DEVOLUCAO SEM REPARO:</strong> Orcamento nao aprovado pelo cliente ou reparo inviavel.</p><p style="font-size:10px;color:#555;margin-top:4px">O equipamento esta sendo devolvido nas mesmas condicoes em que foi recebido.</p></div>
<div class="terms"><h3>Observacoes</h3><p>1. Equipamento devolvido sem reparo, conforme decisao do cliente.</p><p>2. Nao ha cobranca de taxa de diagnostico para este servico.</p><p>3. Caso deseje reavaliar o orcamento, entre em contato: {{company_phone}}.</p></div>
<div class="sigs"><div class="sig">Assinatura do Tecnico<p class="sig-sub">{{company_name}}</p></div><div class="sig">Assinatura do Cliente<p class="sig-sub">{{customer_name}}</p></div></div>
<div class="footer"><strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}</div>
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
    const companyAddress = [
      settingsMap['address_street'],
      settingsMap['address_number'],
      settingsMap['address_complement'],
    ].filter(Boolean).join(', ')
      + (settingsMap['address_neighborhood'] ? ` — ${settingsMap['address_neighborhood']}` : '')
      + (settingsMap['address_zip'] ? ` — CEP ${settingsMap['address_zip']}` : '')
      + (settingsMap['address_city'] ? ` — ${settingsMap['address_city']}` : '')
      + (settingsMap['address_state'] ? `/${settingsMap['address_state']}` : '')
      || '—'

    const template = req.nextUrl.searchParams.get('template') || 'os_full'
    const companyName = company?.name || settingsMap['company_name'] || settingsMap['company.nome_fantasia'] || 'PontualTech'
    const companyPhone = settingsMap['phone'] || settingsMap['company.phone'] || settingsMap['company.whatsapp'] || '(11) 2626-3841'
    const companyEmail = settingsMap['email'] || settingsMap['email.from_address'] || settingsMap['company.email'] || 'contato@pontualtech.com.br'
    const companyCnpj = settingsMap['cnpj'] || settingsMap['company.cnpj'] || '32.772.178/0001-47'
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
      observations: os.reception_notes || '—',
      internal_notes: os.internal_notes || '',
      portal_url: `https://erp.pontualtech.work/portal/pontualtech`,
      portal_instructions: `Acompanhe sua OS online: https://erp.pontualtech.work/portal/pontualtech — Faca login com seu CPF/CNPJ e senha cadastrada. Voce pode consultar o status, aprovar orcamentos e abrir novas OS diretamente pelo portal.`,
      whatsapp_suporte: '(11) 2626-3841',
      whatsapp_link: 'https://wa.me/551126263841',
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
