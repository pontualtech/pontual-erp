const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

function pad(v, len, ch = '0', side = 'left') { const s = String(v); return side === 'left' ? s.padStart(len, ch) : s.padEnd(len, ch); }
function padN(v, len) { return pad(v, len, '0', 'left'); }
function padA(v, len) { return pad(v.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, len), len, ' ', 'right'); }
function formatDate(d) { return d.getDate().toString().padStart(2,'0') + (d.getMonth()+1).toString().padStart(2,'0') + d.getFullYear(); }
function limpar(doc) { return doc.replace(/[.\-\/]/g, ''); }

function gerarRemessa(cedente, boletos, seq) {
  const lines = [];
  const now = new Date();
  const cnpj = limpar(cedente.cnpj);
  const ag = cedente.agencia.replace(/\D/g,'').substring(0,4);
  const agDV = cedente.agencia.replace(/\D/g,'').substring(4,5) || '0';
  const ct = cedente.conta.replace(/\D/g,'').substring(0,12);
  const ctDV = cedente.conta.replace(/[^0-9X]/gi,'').slice(-1) || '0';

  // Header arquivo
  let h = '077' + '0000' + '0' + padA('',9) + '2' + padN(cnpj,14) + padA(cedente.convenio,20) + padN(ag,5) + padA(agDV,1) + padN(ct,12) + padA(ctDV,1) + ' ' + padA(cedente.razaoSocial,30) + padA('BANCO INTER',30) + padA('',10) + '1' + formatDate(now) + padN(now.getHours(),2)+padN(now.getMinutes(),2)+padN(now.getSeconds(),2) + padN(seq,6) + '087' + padN(0,5) + padA('',20) + padA('',20) + padA('',29);
  lines.push(h);

  // Header lote
  let hl = '077' + '0001' + '1' + 'R' + '01' + '00' + '042' + ' ' + '2' + padN(cnpj,15) + padA(cedente.convenio,20) + padN(ag,5) + padA(agDV,1) + padN(ct,12) + padA(ctDV,1) + ' ' + padA(cedente.razaoSocial,30) + padA('',40) + padA('',40) + padN(seq,8) + formatDate(now) + padN(0,8) + padA('',33);
  lines.push(hl);

  let seqR = 0;
  for (const b of boletos) {
    seqR++;
    const doc = limpar(b.sacadoDocumento);
    const tipoDoc = doc.length <= 11 ? '1' : '2';

    // Segmento P
    let pp = '077' + '0001' + '3' + padN(seqR,5) + 'P' + ' ' + '01' + padN(ag,5) + padA(agDV,1) + padN(ct,12) + padA(ctDV,1) + ' ' + padA(b.nossoNumero,20) + '1' + '1' + '1' + '2' + '2' + padA(b.seuNumero,15) + formatDate(b.dataVencimento) + padN(b.valorNominal,15) + padN(0,5) + ' ' + '02' + 'N' + formatDate(b.dataEmissao);
    pp += b.juros ? '1' : '0';
    pp += b.juros ? formatDate(b.dataVencimento) : padN(0,8);
    pp += padN(b.juros ? Math.round((b.valorNominal * (b.juros/100)) / 30) : 0, 15);
    pp += b.desconto ? '1' : '0';
    pp += padN(0,8) + padN(b.desconto||0,15) + padN(0,15) + padN(0,15);
    pp += padA(b.seuNumero,25) + '1' + padN(30,2) + '1' + padN(60,3) + '09' + padN(0,10) + ' ';
    lines.push(pp);

    seqR++;
    // Segmento Q
    let q = '077' + '0001' + '3' + padN(seqR,5) + 'Q' + ' ' + '01' + tipoDoc + padN(doc,15) + padA(b.sacadoNome,40) + padA(b.sacadoEndereco,40) + padA(b.sacadoBairro,15) + padN(limpar(b.sacadoCEP),8) + padA(b.sacadoCidade,15) + padA(b.sacadoUF,2) + '0' + padN(0,15) + padA('',40) + padN(0,3) + padA('',20) + padA('',8);
    lines.push(q);
  }

  // Trailer lote
  let tl = '077' + '0001' + '5' + padA('',9) + padN(seqR+2,6) + padN(0,6) + padN(0,17) + padN(0,6) + padN(0,17) + padN(0,6) + padN(0,17) + padN(0,6) + padN(0,17) + padA('',8) + padA('',117);
  lines.push(tl);

  // Trailer arquivo
  let ta = '077' + '9999' + '9' + padA('',9) + padN(1,6) + padN(seqR+4,6) + padN(0,6) + padA('',205);
  lines.push(ta);

  return lines.map(l => l.padEnd(240)).join('\r\n') + '\r\n';
}

async function main() {
  const settings = await p.setting.findMany({ where: { company_id: 'pontualtech-001', key: { startsWith: 'cnab.' } } });
  const cfg = {};
  settings.forEach(s => cfg[s.key] = s.value);

  const receivables = await p.accountReceivable.findMany({
    where: { company_id: 'pontualtech-001', status: 'PENDENTE', boleto_url: null, customers: { document_number: { not: null } } },
    include: { customers: true },
    take: 3,
    orderBy: { due_date: 'asc' },
  });

  console.log('Contas para remessa:', receivables.length);

  const boletos = receivables.map(r => ({
    nossoNumero: r.id.substring(0, 15).replace(/-/g, ''),
    seuNumero: r.id.substring(0, 15),
    dataVencimento: r.due_date,
    valorNominal: r.total_amount,
    dataEmissao: r.created_at || new Date(),
    sacadoNome: r.customers.legal_name,
    sacadoDocumento: r.customers.document_number,
    sacadoEndereco: ((r.customers.address_street || 'NAO INFORMADO') + ' ' + (r.customers.address_number || '')).trim(),
    sacadoBairro: r.customers.address_neighborhood || 'NAO INFORMADO',
    sacadoCidade: r.customers.address_city || 'SAO PAULO',
    sacadoUF: r.customers.address_state || 'SP',
    sacadoCEP: r.customers.address_zip || '00000000',
    juros: 1.0,
  }));

  boletos.forEach(b => console.log('  R$', (b.valorNominal/100).toFixed(2), '|', b.sacadoNome.substring(0,35), '| Venc:', b.dataVencimento.toISOString().substring(0,10)));

  const cedente = {
    cnpj: cfg['cnab.cnpj'],
    razaoSocial: cfg['cnab.razao_social'],
    agencia: cfg['cnab.agencia'],
    conta: cfg['cnab.conta'],
    convenio: cfg['cnab.convenio'] || cfg['cnab.conta'],
    carteira: cfg['cnab.carteira'],
  };

  const arquivo = gerarRemessa(cedente, boletos, 1);
  const lines = arquivo.split('\r\n').filter(l => l.length > 0);

  console.log('\n=== REMESSA CNAB 240 — BANCO INTER ===');
  console.log('Linhas:', lines.length, '| Tamanho:', arquivo.length, 'bytes');
  console.log('Cedente:', cedente.razaoSocial);
  console.log('Agencia:', cedente.agencia, '| Conta:', cedente.conta);
  console.log('');

  lines.forEach((l, i) => {
    const tipo = l[7];
    const labels = { '0': 'HEADER ARQ ', '1': 'HEADER LOTE', '3': 'DETALHE ' + l[13] + '  ', '5': 'TRAILER LOT', '9': 'TRAILER ARQ' };
    console.log(`${i+1}. [${labels[tipo] || '???'}] ${l.substring(0, 70)}...`);
  });

  const filename = 'C:/Users/pontu/Downloads/REMESSA_INTER_001.rem';
  fs.writeFileSync(filename, arquivo);
  console.log('\nArquivo salvo:', filename);
  console.log('\nProximo passo: fazer upload no Internet Banking do Banco Inter');

  await p.$disconnect();
}
main();
