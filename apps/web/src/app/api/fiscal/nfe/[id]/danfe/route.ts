import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(date: Date | string | null): string {
  if (!date) return '\u2014'
  return new Date(date).toLocaleDateString('pt-BR')
}

function fmtDateTime(date: Date | string | null): string {
  if (!date) return '\u2014'
  const d = new Date(date)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Format access key in groups of 4 digits */
function fmtAccessKey(key: string | null): string {
  if (!key) return '\u2014'
  return key.replace(/(.{4})/g, '$1 ').trim()
}

function escHtml(str: string | null | undefined): string {
  if (!str) return '\u2014'
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDoc(doc: string | null): string {
  if (!doc) return '\u2014'
  const d = doc.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc
}

// ---------------------------------------------------------------------------
// GET /api/fiscal/nfe/[id]/danfe  — Render DANFE HTML for print
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Load invoice with items and customer
    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, company_id: user.companyId, invoice_type: 'NFE' },
      include: {
        customers: true,
        invoice_items: {
          include: {
            products: { select: { id: true, name: true, internal_code: true } },
          },
        },
      },
    })

    if (!invoice) return error('NF-e nao encontrada', 404)

    // Load company
    const company = await prisma.company.findFirst({
      where: { id: user.companyId },
    })

    // Load company settings
    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId },
    })
    const s: Record<string, string> = {}
    for (const row of settings) s[row.key] = row.value

    // Load fiscal config for IE (stored in settings JSON)
    const fiscalConfig = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })
    const fiscalSettings = (fiscalConfig?.settings || {}) as Record<string, any>

    // ---------------------------------------------------------------------------
    // Resolve company fields
    // ---------------------------------------------------------------------------

    const companyName = company?.name || s['company_name'] || s['company.nome_fantasia'] || 'Empresa'
    const companyCnpj = s['cnpj'] || s['company.cnpj'] || '\u2014'
    const companyIe = s['company.ie'] || fiscalSettings.inscricao_estadual || s['inscricao_estadual'] || '\u2014'
    const companyPhone = s['phone'] || s['company.phone'] || s['company.whatsapp'] || '\u2014'
    const companyEmail = s['email'] || s['email.from_address'] || s['company.email'] || ''

    const companyAddress = [
      s['address_street'],
      s['address_number'],
      s['address_complement'],
    ].filter(Boolean).join(', ')
      + (s['address_neighborhood'] ? ' \u2014 ' + s['address_neighborhood'] : '')
    const companyCityState = [s['address_city'], s['address_state']].filter(Boolean).join('/')
    const companyCep = s['address_zip'] ? 'CEP ' + s['address_zip'] : ''

    // ---------------------------------------------------------------------------
    // Customer fields
    // ---------------------------------------------------------------------------

    const cust = invoice.customers
    const custName = escHtml(cust?.legal_name)
    const custDoc = fmtDoc(cust?.document_number || null)
    const custAddress = cust
      ? [cust.address_street, cust.address_number, cust.address_complement, cust.address_neighborhood]
          .filter(Boolean).join(', ')
      : '\u2014'
    const custCityState = cust
      ? [cust.address_city, cust.address_state].filter(Boolean).join('/')
      : ''
    const custCep = cust?.address_zip ? 'CEP ' + cust.address_zip : ''
    const custPhone = cust?.mobile || cust?.phone || ''
    const custEmail = cust?.email || ''
    const custIe = cust?.state_registration || ''

    // ---------------------------------------------------------------------------
    // Invoice data
    // ---------------------------------------------------------------------------

    const nfeNum = invoice.invoice_number ?? '\u2014'
    const nfeSerie = invoice.series || '1'
    const accessKey = invoice.access_key || ''
    const isCancelled = invoice.status === 'CANCELLED'

    // ---------------------------------------------------------------------------
    // Build items table rows
    // ---------------------------------------------------------------------------

    let itemsHtml = ''
    let seq = 0
    for (const item of invoice.invoice_items) {
      seq++
      itemsHtml += `<tr>
        <td class="center">${seq}</td>
        <td>${escHtml(item.description)}</td>
        <td class="center mono">${escHtml(item.ncm)}</td>
        <td class="center mono">${escHtml(item.cfop)}</td>
        <td class="center">${escHtml(item.unidade) || 'UN'}</td>
        <td class="right">${item.quantity}</td>
        <td class="right mono">${fmtCents(item.unit_price)}</td>
        <td class="right mono">${fmtCents(item.total_price)}</td>
      </tr>`
    }

    if (seq === 0) {
      itemsHtml = '<tr><td colspan="8" class="center" style="padding:12px;color:#888;">Nenhum item</td></tr>'
    }

    const totalProdutos = fmtCents(invoice.total_amount ?? 0)
    const totalNfe = fmtCents((invoice.total_amount ?? 0) + (invoice.tax_amount ?? 0))

    // ---------------------------------------------------------------------------
    // Render full DANFE HTML
    // ---------------------------------------------------------------------------

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>DANFE - NF-e ${nfeNum} - ${escHtml(companyName)}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 10mm 12mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10px;
    color: #000;
    line-height: 1.4;
    background: #fff;
  }
  .danfe {
    max-width: 190mm;
    margin: 0 auto;
    border: 2px solid #000;
  }
  .row {
    border-bottom: 1px solid #000;
    display: flex;
  }
  .row:last-child { border-bottom: none; }
  .cell {
    padding: 4px 6px;
    border-right: 1px solid #000;
    flex: 1;
    min-width: 0;
  }
  .cell:last-child { border-right: none; }
  .cell-label {
    font-size: 7px;
    font-weight: 700;
    text-transform: uppercase;
    color: #333;
    letter-spacing: 0.3px;
    margin-bottom: 1px;
    display: block;
  }
  .cell-value {
    font-size: 10px;
    font-weight: 500;
    word-break: break-word;
  }
  .mono { font-family: 'Courier New', Courier, monospace; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .section-header {
    background: #e8e8e8;
    padding: 3px 6px;
    font-size: 8px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    border-bottom: 1px solid #000;
  }

  /* Header row */
  .header-row {
    display: flex;
    border-bottom: 2px solid #000;
  }
  .header-left {
    flex: 1;
    padding: 8px 10px;
    border-right: 1px solid #000;
  }
  .header-left h1 {
    font-size: 14px;
    font-weight: 900;
    margin-bottom: 2px;
  }
  .header-left p {
    font-size: 9px;
    color: #333;
    line-height: 1.5;
  }
  .header-center {
    width: 120px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 6px 8px;
    border-right: 1px solid #000;
    text-align: center;
  }
  .header-center .danfe-title {
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 1px;
    margin-bottom: 2px;
  }
  .header-center .danfe-sub {
    font-size: 6px;
    color: #333;
    line-height: 1.4;
    margin-bottom: 4px;
  }
  .header-center .nfe-num {
    font-size: 10px;
    font-weight: 700;
    margin-top: 2px;
  }
  .header-center .folha {
    font-size: 8px;
    color: #444;
  }
  .header-right {
    width: 200px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .header-right .barcode-placeholder {
    border: 1px dashed #999;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 7px;
    color: #999;
    margin-bottom: 4px;
  }
  .access-key-box {
    padding: 4px 6px;
    border-bottom: 1px solid #000;
  }
  .access-key-box .cell-label { margin-bottom: 2px; }
  .access-key-box .key-value {
    font-family: 'Courier New', Courier, monospace;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    word-break: break-all;
  }

  /* Nature of operation */
  .nat-op {
    padding: 4px 6px;
    border-bottom: 1px solid #000;
  }

  /* Items table */
  .items-table {
    width: 100%;
    border-collapse: collapse;
  }
  .items-table th {
    background: #e8e8e8;
    font-size: 7px;
    font-weight: 800;
    text-transform: uppercase;
    padding: 3px 4px;
    border: 1px solid #000;
    border-top: none;
    letter-spacing: 0.3px;
  }
  .items-table td {
    padding: 3px 4px;
    border: 1px solid #ccc;
    font-size: 9px;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
  }
  .items-table tr:last-child td {
    border-bottom: 1px solid #000;
  }

  /* Totals */
  .totals-row {
    display: flex;
    border-bottom: 1px solid #000;
  }
  .totals-row .cell {
    padding: 3px 6px;
  }

  /* Info adicional */
  .info-adicional {
    padding: 6px 8px;
    min-height: 40px;
    font-size: 8px;
    line-height: 1.5;
    color: #333;
    border-bottom: 1px solid #000;
  }

  /* Footer */
  .danfe-footer {
    padding: 5px 8px;
    font-size: 7px;
    color: #555;
    text-align: center;
    line-height: 1.5;
  }

  /* Cancelled watermark */
  .cancelled-watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 100px;
    font-weight: 900;
    color: rgba(255, 0, 0, 0.12);
    letter-spacing: 10px;
    pointer-events: none;
    z-index: 100;
    white-space: nowrap;
  }

  /* Print styles */
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .danfe { border-width: 2px; }
  }
  @media screen {
    body { padding: 20px; background: #f0f0f0; }
    .danfe { box-shadow: 0 2px 10px rgba(0,0,0,0.15); background: #fff; }
  }
</style>
</head>
<body>
${isCancelled ? '<div class="cancelled-watermark">CANCELADA</div>' : ''}

<div class="danfe">

  <!-- ============ HEADER ============ -->
  <div class="header-row">
    <div class="header-left">
      <h1>${escHtml(companyName)}</h1>
      <p>${escHtml(companyAddress)}</p>
      <p>${escHtml(companyCityState)}${companyCep ? ' \u2014 ' + escHtml(companyCep) : ''}</p>
      <p>Tel: ${escHtml(companyPhone)}${companyEmail ? ' | ' + escHtml(companyEmail) : ''}</p>
    </div>
    <div class="header-center">
      <div class="danfe-title">DANFE</div>
      <div class="danfe-sub">DOCUMENTO AUXILIAR<br>DA NOTA FISCAL<br>ELETRONICA</div>
      <div class="nfe-num">N. ${nfeNum} &mdash; Serie ${escHtml(nfeSerie)}</div>
      <div class="folha">Folha 1/1</div>
    </div>
    <div class="header-right">
      <div class="barcode-placeholder">CODIGO DE BARRAS</div>
      <span class="cell-label">Chave de Acesso</span>
      <span class="mono" style="font-size:7px;letter-spacing:0.5px;word-break:break-all;">${fmtAccessKey(accessKey)}</span>
    </div>
  </div>

  <!-- ============ ACCESS KEY (full width) ============ -->
  <div class="access-key-box">
    <span class="cell-label">Chave de Acesso</span>
    <span class="key-value">${fmtAccessKey(accessKey)}</span>
  </div>

  <!-- ============ NATURE OF OPERATION / PROTOCOL ============ -->
  <div class="row">
    <div class="cell" style="flex:2;">
      <span class="cell-label">Natureza da Operacao</span>
      <span class="cell-value">${invoice.nfe_tipo === 'ENTRADA' ? 'ENTRADA' : 'VENDA DE MERCADORIA'}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Protocolo de Autorizacao</span>
      <span class="cell-value mono">${invoice.authorized_at ? fmtDateTime(invoice.authorized_at) : '\u2014'}</span>
    </div>
  </div>

  <!-- ============ EMITENTE ============ -->
  <div class="section-header">Emitente</div>
  <div class="row">
    <div class="cell" style="flex:3;">
      <span class="cell-label">Nome / Razao Social</span>
      <span class="cell-value bold">${escHtml(companyName)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">CNPJ</span>
      <span class="cell-value mono">${escHtml(companyCnpj)}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell" style="flex:2;">
      <span class="cell-label">Endereco</span>
      <span class="cell-value">${escHtml(companyAddress)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Municipio/UF</span>
      <span class="cell-value">${escHtml(companyCityState)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">CEP</span>
      <span class="cell-value mono">${escHtml(companyCep)}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell">
      <span class="cell-label">Inscricao Estadual</span>
      <span class="cell-value mono">${escHtml(companyIe)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Telefone</span>
      <span class="cell-value">${escHtml(companyPhone)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Data Emissao</span>
      <span class="cell-value">${fmtDateTime(invoice.issued_at || invoice.created_at)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Data Saida</span>
      <span class="cell-value">${fmtDateTime(invoice.authorized_at || invoice.issued_at)}</span>
    </div>
  </div>

  <!-- ============ DESTINATARIO ============ -->
  <div class="section-header">Destinatario / Remetente</div>
  <div class="row">
    <div class="cell" style="flex:3;">
      <span class="cell-label">Nome / Razao Social</span>
      <span class="cell-value bold">${custName}</span>
    </div>
    <div class="cell">
      <span class="cell-label">CPF/CNPJ</span>
      <span class="cell-value mono">${custDoc}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell" style="flex:2;">
      <span class="cell-label">Endereco</span>
      <span class="cell-value">${escHtml(custAddress)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Municipio/UF</span>
      <span class="cell-value">${escHtml(custCityState)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">CEP</span>
      <span class="cell-value mono">${escHtml(custCep)}</span>
    </div>
  </div>
  <div class="row">
    <div class="cell">
      <span class="cell-label">Inscricao Estadual</span>
      <span class="cell-value mono">${escHtml(custIe)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Telefone</span>
      <span class="cell-value">${escHtml(custPhone)}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Email</span>
      <span class="cell-value">${escHtml(custEmail)}</span>
    </div>
  </div>

  <!-- ============ PRODUTOS / SERVICOS ============ -->
  <div class="section-header">Produtos / Servicos</div>
  <table class="items-table">
    <thead>
      <tr>
        <th style="width:28px;">#</th>
        <th>Descricao do Produto/Servico</th>
        <th style="width:65px;">NCM/SH</th>
        <th style="width:45px;">CFOP</th>
        <th style="width:30px;">Un</th>
        <th style="width:35px;">Qtd</th>
        <th style="width:65px;">V. Unit.</th>
        <th style="width:65px;">V. Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <!-- ============ TOTAIS ============ -->
  <div class="section-header">Totais</div>
  <div class="row">
    <div class="cell">
      <span class="cell-label">Valor Total dos Produtos</span>
      <span class="cell-value mono bold">${totalProdutos}</span>
    </div>
    <div class="cell">
      <span class="cell-label">Valor do Frete</span>
      <span class="cell-value mono">R$ 0,00</span>
    </div>
    <div class="cell">
      <span class="cell-label">Valor do Seguro</span>
      <span class="cell-value mono">R$ 0,00</span>
    </div>
    <div class="cell">
      <span class="cell-label">Outras Desp.</span>
      <span class="cell-value mono">R$ 0,00</span>
    </div>
    <div class="cell">
      <span class="cell-label">Valor Total da NF-e</span>
      <span class="cell-value mono bold" style="font-size:12px;">${totalNfe}</span>
    </div>
  </div>

  <!-- ============ TRANSPORTADOR ============ -->
  <div class="section-header">Transportador / Volumes</div>
  <div class="row">
    <div class="cell" style="flex:2;">
      <span class="cell-label">Frete por conta</span>
      <span class="cell-value">9 - Sem frete</span>
    </div>
    <div class="cell">
      <span class="cell-label">Quantidade</span>
      <span class="cell-value">\u2014</span>
    </div>
    <div class="cell">
      <span class="cell-label">Especie</span>
      <span class="cell-value">\u2014</span>
    </div>
    <div class="cell">
      <span class="cell-label">Peso Bruto</span>
      <span class="cell-value">\u2014</span>
    </div>
    <div class="cell">
      <span class="cell-label">Peso Liquido</span>
      <span class="cell-value">\u2014</span>
    </div>
  </div>

  <!-- ============ INFORMACOES ADICIONAIS ============ -->
  <div class="section-header">Informacoes Adicionais</div>
  <div class="info-adicional">
    ${escHtml(invoice.notes) || 'Sem informacoes complementares.'}
  </div>

  <!-- ============ FOOTER ============ -->
  <div class="danfe-footer">
    Consulte pela Chave de Acesso em: <strong>www.nfe.fazenda.gov.br/portal/consultaRecibo.aspx</strong><br>
    ${escHtml(companyName)} &mdash; Tel: ${escHtml(companyPhone)}
  </div>

</div>

<script>window.onload = function() { window.print(); }</script>
</body>
</html>`

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    return handleError(err)
  }
}
