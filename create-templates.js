const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const COMPANY_ID = 'pontualtech-001';

const STYLE = `
<style>
  @page { size: A4; margin: 12mm 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #222; padding: 20px; max-width: 800px; margin: 0 auto; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #222; padding-bottom: 12px; margin-bottom: 14px; }
  .header .company-info { max-width: 65%; }
  .header h1 { font-size: 18px; font-weight: 800; letter-spacing: -0.3px; margin-bottom: 1px; }
  .header .co-sub { font-size: 9px; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
  .header .subtitle { font-size: 10px; color: #555; line-height: 1.5; }
  .header .os-number { font-size: 24px; font-weight: 900; text-align: right; letter-spacing: -0.3px; }
  .header .status { display: inline-block; padding: 4px 12px; background: #222; color: #fff; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .section { margin-bottom: 12px; }
  .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #222; border-bottom: 2px solid #ddd; padding-bottom: 4px; margin-bottom: 8px; letter-spacing: 0.8px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px 16px; }
  .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 5px 12px; }
  .field { margin-bottom: 2px; }
  .field-label { font-size: 9px; color: #888; text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px; }
  .field-value { font-size: 11px; font-weight: 500; }
  .full-width { grid-column: 1 / -1; }
  .text-box { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px; padding: 8px 10px; font-size: 11px; min-height: 24px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  th { background: #f0f0f0; padding: 6px 8px; text-align: left; font-size: 9px; font-weight: 800; text-transform: uppercase; color: #444; border: 1px solid #ddd; letter-spacing: 0.3px; }
  td { padding: 6px 8px; border: 1px solid #e0e0e0; font-size: 10px; }
  tr:nth-child(even) td { background: #fafafa; }
  .total-row { background: #f0f0f0 !important; font-weight: 900; }
  .total-row td { background: #f0f0f0 !important; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .highlight { background: #f8f8f8; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; font-size: 11px; line-height: 1.5; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 9px; color: #888; text-align: center; }
  .footer strong { color: #555; }
  .signature { margin-top: 36px; display: flex; justify-content: space-around; }
  .signature-line { width: 200px; text-align: center; border-top: 1px solid #333; padding-top: 5px; font-size: 10px; font-weight: 600; color: #555; }
  .signature-sub { font-size: 9px; color: #888; margin-top: 2px; font-weight: 400; }
  @media print { body { padding: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @media screen { body { background: #f5f5f5; } }
</style>`;

const templates = [
  {
    type: 'os_receipt',
    name: 'Comprovante de Recebimento',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recebimento OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div class="company-info"><h1>{{company_name}}</h1><p class="co-sub">Assistencia Tecnica em Informatica</p><p class="subtitle">CNPJ: {{company_cnpj}}</p><p class="subtitle">{{company_address}}</p><p class="subtitle">Tel: {{company_phone}} | {{company_email}}</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><p class="subtitle" style="text-align:right;">{{data_abertura}}</p><p class="status" style="margin-top:6px;">RECEBIMENTO</p></div>
</div>
<div class="section"><div class="section-title">Dados do Cliente</div>
  <div class="grid">
    <div class="field"><span class="field-label">Nome</span><br><span class="field-value">{{cliente_nome}}</span></div>
    <div class="field"><span class="field-label">CPF/CNPJ</span><br><span class="field-value">{{cliente_documento}}</span></div>
    <div class="field"><span class="field-label">Telefone</span><br><span class="field-value">{{cliente_telefone}}</span></div>
    <div class="field"><span class="field-label">Email</span><br><span class="field-value">{{cliente_email}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Equipamento</div>
  <div class="grid-4">
    <div class="field"><span class="field-label">Equipamento</span><br><span class="field-value">{{equipamento}}</span></div>
    <div class="field"><span class="field-label">Marca / Modelo</span><br><span class="field-value">{{marca}} {{modelo}}</span></div>
    <div class="field"><span class="field-label">N. Serie</span><br><span class="field-value">{{serie}}</span></div>
    <div class="field"><span class="field-label">Tipo</span><br><span class="field-value">{{tipo_os}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Problema Relatado</div>
  <div class="text-box">{{problema}}</div>
</div>
<div class="section"><div class="section-title">Observacoes de Recebimento</div>
  <div class="text-box">{{observacoes_recebimento}}</div>
</div>
<div class="signature">
  <div class="signature-line">Assinatura do Cliente<p class="signature-sub">{{cliente_nome}}</p></div>
  <div class="signature-line">Assinatura do Tecnico<p class="signature-sub">{{company_name}}</p></div>
</div>
<div class="footer"><strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}</div>
</body></html>`,
  },
  {
    type: 'os_budget',
    name: 'Orcamento',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Orcamento OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div class="company-info"><h1>{{company_name}}</h1><p class="co-sub">Assistencia Tecnica em Informatica</p><p class="subtitle">CNPJ: {{company_cnpj}}</p><p class="subtitle">{{company_address}}</p><p class="subtitle">Tel: {{company_phone}} | {{company_email}}</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><p class="status" style="margin-top:6px;">ORCAMENTO</p></div>
</div>
<div class="section"><div class="section-title">Dados do Cliente</div>
  <div class="grid">
    <div class="field"><span class="field-label">Nome</span><br><span class="field-value">{{cliente_nome}}</span></div>
    <div class="field"><span class="field-label">CPF/CNPJ</span><br><span class="field-value">{{cliente_documento}}</span></div>
    <div class="field"><span class="field-label">Telefone</span><br><span class="field-value">{{cliente_telefone}}</span></div>
    <div class="field"><span class="field-label">Email</span><br><span class="field-value">{{cliente_email}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Equipamento</div>
  <div class="grid-3">
    <div class="field"><span class="field-label">Equipamento</span><br><span class="field-value">{{equipamento}}</span></div>
    <div class="field"><span class="field-label">Marca / Modelo</span><br><span class="field-value">{{marca}} {{modelo}}</span></div>
    <div class="field"><span class="field-label">N. Serie</span><br><span class="field-value">{{serie}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Diagnostico / Laudo</div>
  <div class="text-box">{{diagnostico}}</div>
</div>
<div class="section"><div class="section-title">Itens do Orcamento</div>
  <table>
    <thead><tr><th>Tipo</th><th>Descricao</th><th class="text-center">Qtd</th><th class="text-right">Unitario</th><th class="text-right">Total</th></tr></thead>
    <tbody>{{itens_tabela}}</tbody>
    <tfoot><tr class="total-row"><td colspan="4" class="text-right">TOTAL</td><td class="text-right">{{valor_total}}</td></tr></tfoot>
  </table>
</div>
<div class="section"><div class="section-title">Condicoes</div>
  <ul style="padding-left:16px;font-size:10px;line-height:1.8;">
    <li>Validade do orcamento: 15 dias</li>
    <li>Previsao de entrega: {{previsao_entrega}}</li>
    <li>Garantia: 90 dias sobre o servico executado</li>
    <li>Forma de pagamento: a combinar</li>
  </ul>
</div>
<div class="signature">
  <div class="signature-line">Assinatura do Tecnico<p class="signature-sub">{{company_name}}</p></div>
  <div class="signature-line">Assinatura do Cliente — Aprovacao<p class="signature-sub">{{cliente_nome}}</p></div>
</div>
<div class="footer"><strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}</div>
</body></html>`,
  },
  {
    type: 'os_full',
    name: 'Ordem de Servico Completa',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div class="company-info"><h1>{{company_name}}</h1><p class="co-sub">Assistencia Tecnica em Informatica</p><p class="subtitle">CNPJ: {{company_cnpj}}</p><p class="subtitle">{{company_address}}</p><p class="subtitle">Tel: {{company_phone}} | {{company_email}}</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><p class="status" style="margin-top:6px;">{{status}}</p><p class="subtitle" style="margin-top:4px;text-align:right;">{{data_abertura}}</p></div>
</div>
<div class="section"><div class="section-title">Dados da OS</div>
  <div class="grid-4">
    <div class="field"><span class="field-label">Tipo</span><br><span class="field-value">{{tipo_os}}</span></div>
    <div class="field"><span class="field-label">Prioridade</span><br><span class="field-value">{{prioridade}}</span></div>
    <div class="field"><span class="field-label">Previsao</span><br><span class="field-value">{{previsao_entrega}}</span></div>
    <div class="field"><span class="field-label">Tecnico</span><br><span class="field-value">{{tecnico}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Dados do Cliente</div>
  <div class="grid">
    <div class="field"><span class="field-label">Nome</span><br><span class="field-value">{{cliente_nome}}</span></div>
    <div class="field"><span class="field-label">CPF/CNPJ</span><br><span class="field-value">{{cliente_documento}}</span></div>
    <div class="field"><span class="field-label">Telefone</span><br><span class="field-value">{{cliente_telefone}}</span></div>
    <div class="field"><span class="field-label">Email</span><br><span class="field-value">{{cliente_email}}</span></div>
    <div class="field full-width"><span class="field-label">Endereco</span><br><span class="field-value">{{cliente_endereco}}, {{cliente_cidade}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Equipamento</div>
  <div class="grid-4">
    <div class="field"><span class="field-label">Equipamento</span><br><span class="field-value">{{equipamento}}</span></div>
    <div class="field"><span class="field-label">Marca</span><br><span class="field-value">{{marca}}</span></div>
    <div class="field"><span class="field-label">Modelo</span><br><span class="field-value">{{modelo}}</span></div>
    <div class="field"><span class="field-label">N. Serie</span><br><span class="field-value">{{serie}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Problema Relatado</div>
  <div class="text-box">{{problema}}</div>
</div>
<div class="section"><div class="section-title">Diagnostico / Laudo</div>
  <div class="text-box">{{diagnostico}}</div>
</div>
<div class="section"><div class="section-title">Servicos e Pecas</div>
  <table>
    <thead><tr><th>Tipo</th><th>Descricao</th><th class="text-center">Qtd</th><th class="text-right">Unitario</th><th class="text-right">Total</th></tr></thead>
    <tbody>{{itens_tabela}}</tbody>
    <tfoot><tr class="total-row"><td colspan="4" class="text-right">TOTAL</td><td class="text-right">{{valor_total}}</td></tr></tfoot>
  </table>
  <p style="margin-top:6px;font-size:11px;"><strong>Forma de pagamento:</strong> {{forma_pagamento}}</p>
</div>
<div class="section"><div class="section-title">Observacoes Internas</div>
  <p style="font-size:10px;color:#666;">{{observacoes_internas}}</p>
</div>
<div class="signature">
  <div class="signature-line">Assinatura do Tecnico<p class="signature-sub">{{company_name}}</p></div>
  <div class="signature-line">Assinatura do Cliente<p class="signature-sub">{{cliente_nome}}</p></div>
</div>
<div class="footer"><strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}</div>
</body></html>`,
  },
  {
    type: 'os_delivery',
    name: 'Comprovante de Entrega',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Entrega OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div class="company-info"><h1>{{company_name}}</h1><p class="co-sub">Assistencia Tecnica em Informatica</p><p class="subtitle">CNPJ: {{company_cnpj}}</p><p class="subtitle">{{company_address}}</p><p class="subtitle">Tel: {{company_phone}} | {{company_email}}</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><p class="status" style="margin-top:6px;">ENTREGUE</p></div>
</div>
<div class="section"><div class="section-title">Dados do Cliente</div>
  <div class="grid">
    <div class="field"><span class="field-label">Nome</span><br><span class="field-value">{{cliente_nome}}</span></div>
    <div class="field"><span class="field-label">CPF/CNPJ</span><br><span class="field-value">{{cliente_documento}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Equipamento</div>
  <div class="grid-3">
    <div class="field"><span class="field-label">Equipamento</span><br><span class="field-value">{{equipamento}}</span></div>
    <div class="field"><span class="field-label">Marca / Modelo</span><br><span class="field-value">{{marca}} {{modelo}}</span></div>
    <div class="field"><span class="field-label">N. Serie</span><br><span class="field-value">{{serie}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Servico Realizado</div>
  <div class="text-box">{{diagnostico}}</div>
</div>
<div class="section"><div class="section-title">Resumo Financeiro</div>
  <table>
    <thead><tr><th>Descricao</th><th class="text-right">Total</th></tr></thead>
    <tbody>{{itens_tabela_simples}}</tbody>
    <tfoot><tr class="total-row"><td class="text-right">TOTAL</td><td class="text-right">{{valor_total}}</td></tr></tfoot>
  </table>
  <p style="margin-top:6px;font-size:11px;"><strong>Forma de pagamento:</strong> {{forma_pagamento}}</p>
</div>
<div class="section"><div class="section-title">Termo de Garantia</div>
  <div class="highlight">
    <p><strong>Garantia de 90 dias</strong> sobre o servico executado, contados a partir desta data ({{data_entrega}}).</p>
    <p style="margin-top:4px;font-size:10px;color:#666;">A garantia cobre exclusivamente os servicos e pecas descritos acima. Nao cobre mau uso, quedas, sobrecarga eletrica ou intervencao de terceiros. Para acionar a garantia, entre em contato: {{company_phone}}.</p>
  </div>
</div>
<div class="signature">
  <div class="signature-line">Assinatura do Tecnico<p class="signature-sub">{{company_name}}</p></div>
  <div class="signature-line">Assinatura do Cliente<p class="signature-sub">{{cliente_nome}}</p></div>
</div>
<div class="footer"><strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}</div>
</body></html>`,
  },
  {
    type: 'os_warranty',
    name: 'Termo de Garantia',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Garantia OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div class="company-info"><h1>{{company_name}}</h1><p class="co-sub">Assistencia Tecnica em Informatica</p><p class="subtitle">CNPJ: {{company_cnpj}}</p><p class="subtitle">{{company_address}}</p><p class="subtitle">Tel: {{company_phone}} | {{company_email}}</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><p class="status" style="margin-top:6px;">GARANTIA</p></div>
</div>
<div class="section" style="text-align:center;margin:16px 0;">
  <h2 style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Termo de Garantia de Servico</h2>
</div>
<div class="section">
  <p style="line-height:1.7;font-size:11px;">
    Certificamos que o servico executado na <strong>OS-{{os_number}}</strong>, referente ao equipamento
    <strong>{{equipamento}} {{marca}} {{modelo}}</strong> (N. Serie: {{serie}}), de propriedade de
    <strong>{{cliente_nome}}</strong> ({{cliente_documento}}), possui garantia conforme as condicoes abaixo:
  </p>
</div>
<div class="section"><div class="section-title">Servico Executado</div>
  <div class="text-box">{{diagnostico}}</div>
  <table style="margin-top:8px;">
    <thead><tr><th>Descricao</th><th class="text-right">Valor</th></tr></thead>
    <tbody>{{itens_tabela_simples}}</tbody>
    <tfoot><tr class="total-row"><td class="text-right">TOTAL</td><td class="text-right">{{valor_total}}</td></tr></tfoot>
  </table>
</div>
<div class="section"><div class="section-title">Condicoes da Garantia</div>
  <ol style="padding-left:16px;line-height:1.8;font-size:10px;">
    <li>A garantia e de <strong>90 (noventa) dias</strong> contados a partir da data de entrega ({{data_entrega}}).</li>
    <li>Cobre exclusivamente o servico executado e as pecas substituidas nesta ordem de servico.</li>
    <li>Nao cobre danos causados por: mau uso, queda, sobrecarga eletrica, uso de suprimentos incompativeis, tentativa de reparo por terceiros ou desastres naturais.</li>
    <li>Para acionar a garantia, o cliente deve apresentar este termo ou o numero da OS.</li>
    <li>O prazo para avaliacao do equipamento em garantia e de ate 5 dias uteis.</li>
    <li>Pecas substituidas em garantia terao garantia pelo periodo restante da garantia original.</li>
  </ol>
</div>
<div class="signature" style="margin-top:30px;">
  <div class="signature-line">Assinatura do Tecnico<p class="signature-sub">{{company_name}}</p></div>
  <div class="signature-line">Assinatura do Cliente<p class="signature-sub">{{cliente_nome}}</p></div>
</div>
<div class="footer"><strong>{{company_name}}</strong> &mdash; {{company_address}} &mdash; Tel: {{company_phone}} &mdash; {{company_email}} &mdash; CNPJ: {{company_cnpj}}<br>Emissao: {{data_impressao}} &mdash; Validade: 90 dias a partir de {{data_entrega}}</div>
</body></html>`,
  },
  {
    type: 'os_label',
    name: 'Etiqueta de Identificacao',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Etiqueta OS {{os_number}}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; padding: 8px; width: 280px; color: #222; }
  .label-box { border: 3px solid #222; padding: 10px; border-radius: 6px; }
  .label-header { font-size: 16px; font-weight: 900; text-align: center; border-bottom: 2px solid #222; padding-bottom: 5px; margin-bottom: 6px; letter-spacing: -0.3px; }
  .label-company { font-size: 8px; text-align: center; color: #555; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .label-field { margin-bottom: 3px; line-height: 1.3; }
  .label-field strong { display: inline-block; width: 55px; font-size: 8px; text-transform: uppercase; color: #555; font-weight: 700; letter-spacing: 0.3px; }
  .label-field span { font-weight: 500; }
  @media print { body { margin: 0; padding: 4px; } }
</style></head><body>
<div class="label-box">
  <div class="label-header">OS {{os_number}}</div>
  <div class="label-company">{{company_name}}</div>
  <div class="label-field"><strong>Cliente:</strong> <span>{{cliente_nome}}</span></div>
  <div class="label-field"><strong>Equip:</strong> <span>{{equipamento}}</span></div>
  <div class="label-field"><strong>Marca:</strong> <span>{{marca}} {{modelo}}</span></div>
  <div class="label-field"><strong>Serie:</strong> <span>{{serie}}</span></div>
  <div class="label-field"><strong>Data:</strong> <span>{{data_abertura}}</span></div>
  <div class="label-field"><strong>Status:</strong> <span>{{status}}</span></div>
</div>
</body></html>`,
  },
];

async function main() {
  for (const tpl of templates) {
    const existing = await p.printTemplate.findFirst({
      where: { company_id: COMPANY_ID, type: tpl.type },
    });
    if (existing) {
      console.log('Ja existe:', tpl.type, '-', tpl.name);
      continue;
    }
    await p.printTemplate.create({
      data: {
        company_id: COMPANY_ID,
        type: tpl.type,
        name: tpl.name,
        html_template: tpl.html,
        is_default: true,
        is_active: true,
      },
    });
    console.log('Criado:', tpl.type, '-', tpl.name);
  }
  console.log('\nDone!');
  await p.$disconnect();
}
main();
