const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const COMPANY_ID = 'pontualtech-001';

const STYLE = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #333; padding: 20px; max-width: 800px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a56db; padding-bottom: 12px; margin-bottom: 16px; }
  .header h1 { font-size: 18px; color: #1a56db; }
  .header .subtitle { font-size: 11px; color: #666; }
  .header .os-number { font-size: 22px; font-weight: bold; color: #1a56db; text-align: right; }
  .header .status { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: bold; color: white; background: #6b7280; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #1a56db; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 8px; letter-spacing: 0.5px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 16px; }
  .field { margin-bottom: 2px; }
  .field-label { font-size: 9px; color: #888; text-transform: uppercase; }
  .field-value { font-size: 12px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  th { background: #f3f4f6; padding: 6px 8px; text-align: left; font-size: 10px; font-weight: bold; text-transform: uppercase; color: #555; border: 1px solid #ddd; }
  td { padding: 6px 8px; border: 1px solid #ddd; font-size: 11px; }
  .total-row { background: #eff6ff; font-weight: bold; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .highlight { background: #f0f9ff; padding: 10px; border-radius: 6px; border: 1px solid #bfdbfe; }
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 9px; color: #888; text-align: center; }
  .signature { margin-top: 40px; display: flex; justify-content: space-around; }
  .signature-line { width: 200px; text-align: center; border-top: 1px solid #333; padding-top: 4px; font-size: 10px; }
  @media print { body { padding: 10px; } }
  @media screen { body { background: #f5f5f5; } }
</style>`;

const templates = [
  {
    type: 'os_receipt',
    name: 'Comprovante de Recebimento',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recebimento OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div><h1>{{company_name}}</h1><p class="subtitle">Comprovante de Recebimento de Equipamento</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><p class="subtitle">{{data_abertura}}</p></div>
</div>
<div class="section"><div class="section-title">Cliente</div>
  <div class="grid">
    <div class="field"><span class="field-label">Nome</span><br><span class="field-value">{{cliente_nome}}</span></div>
    <div class="field"><span class="field-label">CPF/CNPJ</span><br><span class="field-value">{{cliente_documento}}</span></div>
    <div class="field"><span class="field-label">Telefone</span><br><span class="field-value">{{cliente_telefone}}</span></div>
    <div class="field"><span class="field-label">Email</span><br><span class="field-value">{{cliente_email}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Equipamento</div>
  <div class="grid">
    <div class="field"><span class="field-label">Equipamento</span><br><span class="field-value">{{equipamento}}</span></div>
    <div class="field"><span class="field-label">Marca / Modelo</span><br><span class="field-value">{{marca}} {{modelo}}</span></div>
    <div class="field"><span class="field-label">N. Serie</span><br><span class="field-value">{{serie}}</span></div>
    <div class="field"><span class="field-label">Tipo</span><br><span class="field-value">{{tipo_os}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Problema Relatado</div>
  <div class="highlight">{{problema}}</div>
</div>
<div class="section"><div class="section-title">Observacoes de Recebimento</div>
  <p>{{observacoes_recebimento}}</p>
</div>
<div class="signature">
  <div class="signature-line">Responsavel pela Entrega</div>
  <div class="signature-line">Responsavel pelo Recebimento</div>
</div>
<div class="footer">{{company_name}} — Impresso em {{data_impressao}}</div>
</body></html>`,
  },
  {
    type: 'os_budget',
    name: 'Orcamento',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Orcamento OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div><h1>{{company_name}}</h1><p class="subtitle">Orcamento de Servico</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><span class="status" style="background:#f59e0b;">Orcamento</span></div>
</div>
<div class="section"><div class="section-title">Cliente</div>
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
<div class="section"><div class="section-title">Diagnostico</div>
  <div class="highlight">{{diagnostico}}</div>
</div>
<div class="section"><div class="section-title">Itens do Orcamento</div>
  <table>
    <thead><tr><th>Tipo</th><th>Descricao</th><th class="text-center">Qtd</th><th class="text-right">Unitario</th><th class="text-right">Total</th></tr></thead>
    <tbody>{{itens_tabela}}</tbody>
    <tfoot><tr class="total-row"><td colspan="4" class="text-right">TOTAL</td><td class="text-right">{{valor_total}}</td></tr></tfoot>
  </table>
</div>
<div class="section"><div class="section-title">Condicoes</div>
  <ul style="padding-left:16px;font-size:11px;">
    <li>Validade do orcamento: 15 dias</li>
    <li>Previsao de entrega: {{previsao_entrega}}</li>
    <li>Garantia: 90 dias sobre o servico executado</li>
    <li>Forma de pagamento: a combinar</li>
  </ul>
</div>
<div class="signature">
  <div class="signature-line">{{company_name}}</div>
  <div class="signature-line">Cliente — Aprovacao</div>
</div>
<div class="footer">{{company_name}} — Impresso em {{data_impressao}}</div>
</body></html>`,
  },
  {
    type: 'os_full',
    name: 'Ordem de Servico Completa',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div><h1>{{company_name}}</h1><p class="subtitle">Ordem de Servico</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><span class="status">{{status}}</span><p class="subtitle" style="margin-top:4px;">{{data_abertura}}</p></div>
</div>
<div class="section"><div class="section-title">Dados da OS</div>
  <div class="grid">
    <div class="field"><span class="field-label">Tipo</span><br><span class="field-value">{{tipo_os}}</span></div>
    <div class="field"><span class="field-label">Prioridade</span><br><span class="field-value">{{prioridade}}</span></div>
    <div class="field"><span class="field-label">Previsao</span><br><span class="field-value">{{previsao_entrega}}</span></div>
    <div class="field"><span class="field-label">Tecnico</span><br><span class="field-value">{{tecnico}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Cliente</div>
  <div class="grid">
    <div class="field"><span class="field-label">Nome</span><br><span class="field-value">{{cliente_nome}}</span></div>
    <div class="field"><span class="field-label">CPF/CNPJ</span><br><span class="field-value">{{cliente_documento}}</span></div>
    <div class="field"><span class="field-label">Telefone</span><br><span class="field-value">{{cliente_telefone}}</span></div>
    <div class="field"><span class="field-label">Email</span><br><span class="field-value">{{cliente_email}}</span></div>
    <div class="field"><span class="field-label">Endereco</span><br><span class="field-value">{{cliente_endereco}}</span></div>
    <div class="field"><span class="field-label">Cidade/UF</span><br><span class="field-value">{{cliente_cidade}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Equipamento</div>
  <div class="grid">
    <div class="field"><span class="field-label">Equipamento</span><br><span class="field-value">{{equipamento}}</span></div>
    <div class="field"><span class="field-label">Marca</span><br><span class="field-value">{{marca}}</span></div>
    <div class="field"><span class="field-label">Modelo</span><br><span class="field-value">{{modelo}}</span></div>
    <div class="field"><span class="field-label">N. Serie</span><br><span class="field-value">{{serie}}</span></div>
  </div>
</div>
<div class="section"><div class="section-title">Problema Relatado</div>
  <div class="highlight">{{problema}}</div>
</div>
<div class="section"><div class="section-title">Diagnostico</div>
  <p>{{diagnostico}}</p>
</div>
<div class="section"><div class="section-title">Servicos e Pecas</div>
  <table>
    <thead><tr><th>Tipo</th><th>Descricao</th><th class="text-center">Qtd</th><th class="text-right">Unitario</th><th class="text-right">Total</th></tr></thead>
    <tbody>{{itens_tabela}}</tbody>
    <tfoot><tr class="total-row"><td colspan="4" class="text-right">TOTAL</td><td class="text-right">{{valor_total}}</td></tr></tfoot>
  </table>
</div>
<div class="section"><div class="section-title">Observacoes Internas</div>
  <p style="font-size:10px;color:#666;">{{observacoes_internas}}</p>
</div>
<div class="footer">{{company_name}} — Impresso em {{data_impressao}}</div>
</body></html>`,
  },
  {
    type: 'os_delivery',
    name: 'Comprovante de Entrega',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Entrega OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div><h1>{{company_name}}</h1><p class="subtitle">Comprovante de Entrega de Equipamento</p></div>
  <div><p class="os-number">OS-{{os_number}}</p><span class="status" style="background:#16a34a;">Entregue</span></div>
</div>
<div class="section"><div class="section-title">Cliente</div>
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
  <div class="highlight">{{diagnostico}}</div>
</div>
<div class="section"><div class="section-title">Resumo Financeiro</div>
  <table>
    <thead><tr><th>Tipo</th><th>Descricao</th><th class="text-center">Qtd</th><th class="text-right">Total</th></tr></thead>
    <tbody>{{itens_tabela_simples}}</tbody>
    <tfoot><tr class="total-row"><td colspan="3" class="text-right">TOTAL</td><td class="text-right">{{valor_total}}</td></tr></tfoot>
  </table>
  <p style="margin-top:6px;font-size:11px;"><strong>Forma de pagamento:</strong> {{forma_pagamento}}</p>
</div>
<div class="section"><div class="section-title">Garantia</div>
  <div class="highlight">
    <p><strong>Garantia de 90 dias</strong> sobre o servico executado, contados a partir desta data.</p>
    <p style="margin-top:4px;font-size:10px;color:#666;">A garantia nao cobre mau uso, danos por queda, sobrecarga eletrica ou uso de suprimentos incompativeis.</p>
  </div>
</div>
<div class="signature">
  <div class="signature-line">{{company_name}}</div>
  <div class="signature-line">Cliente — Recebimento</div>
</div>
<div class="footer">{{company_name}} — Entregue em {{data_entrega}} — Impresso em {{data_impressao}}</div>
</body></html>`,
  },
  {
    type: 'os_warranty',
    name: 'Termo de Garantia',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Garantia OS {{os_number}}</title>${STYLE}</head><body>
<div class="header">
  <div><h1>{{company_name}}</h1><p class="subtitle">Termo de Garantia</p></div>
  <div><p class="os-number">OS-{{os_number}}</p></div>
</div>
<div class="section" style="text-align:center;margin:20px 0;">
  <h2 style="font-size:16px;color:#1a56db;">TERMO DE GARANTIA DE SERVICO</h2>
</div>
<div class="section">
  <p style="line-height:1.6;font-size:12px;">
    Certificamos que o servico executado na <strong>OS-{{os_number}}</strong>, referente ao equipamento
    <strong>{{equipamento}} {{marca}} {{modelo}}</strong> (N. Serie: {{serie}}), de propriedade de
    <strong>{{cliente_nome}}</strong> ({{cliente_documento}}), possui garantia conforme as condicoes abaixo:
  </p>
</div>
<div class="section"><div class="section-title">Servico Executado</div>
  <div class="highlight">{{diagnostico}}</div>
  <table style="margin-top:8px;">
    <thead><tr><th>Descricao</th><th class="text-right">Valor</th></tr></thead>
    <tbody>{{itens_tabela_simples}}</tbody>
    <tfoot><tr class="total-row"><td class="text-right">TOTAL</td><td class="text-right">{{valor_total}}</td></tr></tfoot>
  </table>
</div>
<div class="section"><div class="section-title">Condicoes da Garantia</div>
  <ol style="padding-left:16px;line-height:1.8;font-size:11px;">
    <li>A garantia e de <strong>90 (noventa) dias</strong> contados a partir da data de entrega ({{data_entrega}}).</li>
    <li>Cobre exclusivamente o servico executado e as pecas substituidas nesta ordem de servico.</li>
    <li>Nao cobre danos causados por: mau uso, queda, sobrecarga eletrica, uso de suprimentos incompativeis, tentativa de reparo por terceiros ou desastres naturais.</li>
    <li>Para acionar a garantia, o cliente deve apresentar este termo ou o numero da OS.</li>
    <li>O prazo para avaliacao do equipamento em garantia e de ate 5 dias uteis.</li>
    <li>Pecas substituidas em garantia terao garantia pelo periodo restante da garantia original.</li>
  </ol>
</div>
<div class="signature" style="margin-top:30px;">
  <div class="signature-line">{{company_name}}</div>
  <div class="signature-line">Cliente</div>
</div>
<div class="footer">{{company_name}} — Data de emissao: {{data_impressao}} — Validade: 90 dias a partir de {{data_entrega}}</div>
</body></html>`,
  },
  {
    type: 'os_label',
    name: 'Etiqueta de Identificacao',
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Etiqueta OS {{os_number}}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; padding: 8px; width: 280px; }
  .label-box { border: 2px solid #333; padding: 8px; border-radius: 6px; }
  .label-header { font-size: 14px; font-weight: bold; text-align: center; border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 6px; }
  .label-field { margin-bottom: 3px; }
  .label-field strong { display: inline-block; width: 60px; font-size: 9px; text-transform: uppercase; color: #555; }
  @media print { body { margin: 0; padding: 4px; } }
</style></head><body>
<div class="label-box">
  <div class="label-header">OS-{{os_number}}</div>
  <div class="label-field"><strong>Cliente:</strong> {{cliente_nome}}</div>
  <div class="label-field"><strong>Equip:</strong> {{equipamento}}</div>
  <div class="label-field"><strong>Marca:</strong> {{marca}} {{modelo}}</div>
  <div class="label-field"><strong>Serie:</strong> {{serie}}</div>
  <div class="label-field"><strong>Data:</strong> {{data_abertura}}</div>
  <div class="label-field"><strong>Status:</strong> {{status}}</div>
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
