const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const p = new PrismaClient();

function padNum(v, len) { return String(v).padStart(len, '0').substring(0, len); }
function padAlfa(v, len) { return v.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').substring(0, len).padEnd(len, ' '); }
function fmtDate(d) { return d.getDate().toString().padStart(2,'0') + (d.getMonth()+1).toString().padStart(2,'0') + d.getFullYear().toString().substring(2); }
function limpar(doc) { return doc.replace(/[.\-\/]/g, ''); }

async function main() {
  const settings = await p.setting.findMany({ where: { company_id: 'pontualtech-001', key: { startsWith: 'cnab.' } } });
  const cfg = {};
  settings.forEach(s => cfg[s.key] = s.value);

  const receivables = await p.accountReceivable.findMany({
    where: { company_id: 'pontualtech-001', status: 'PENDENTE', boleto_url: null, customers: { document_number: { not: null } } },
    include: { customers: { select: { legal_name: true, document_number: true, email: true, address_street: true, address_number: true, address_state: true, address_zip: true } } },
    take: 3,
    orderBy: { due_date: 'asc' },
  });

  console.log('=== Teste CNAB 400 Inter ===');
  console.log('Contas:', receivables.length);

  const lines = [];
  let seq = 1;
  const now = new Date();
  const conta = (cfg['cnab.conta'] || '004025073').replace(/\D/g, '').substring(0, 9);
  const contaDV = '3';

  // HEADER
  let h = '0' + '1' + padAlfa('REMESSA', 7) + '01' + padAlfa('COBRANCA', 15) + padAlfa('', 20) + padAlfa(cfg['cnab.razao_social'] || 'PONTUAL TECH', 30) + '077' + padAlfa('INTER', 15) + fmtDate(now) + padAlfa('', 10) + padNum(1, 7) + padAlfa('', 277) + padNum(seq, 6);
  lines.push(h);
  console.log('Header:', h.length, 'bytes', h.length === 400 ? 'OK' : 'ERRO!');

  for (const r of receivables) {
    seq++;
    const doc = limpar(r.customers.document_number);
    const tipoDoc = doc.length <= 11 ? '01' : '02';
    const venc1dia = new Date(r.due_date); venc1dia.setDate(venc1dia.getDate() + 1);

    // TIPO 1
    let t1 = '1' + padAlfa('', 19) + '112' + padNum(cfg['cnab.agencia'] || '0001', 4) + padNum(conta, 9) + contaDV;
    t1 += padAlfa(r.id.substring(0, 25), 25); // controle
    t1 += '001'; // formato boleto
    t1 += '2'; // multa percentual
    t1 += padNum(0, 13); // valor multa
    t1 += padNum(200, 4); // 2.00%
    t1 += fmtDate(venc1dia); // data multa
    t1 += padNum(0, 11); // nosso numero (zeros = 112)
    t1 += padAlfa('', 8); // branco
    t1 += '01'; // ocorrencia remessa
    t1 += padAlfa(r.id.substring(0, 10), 10); // seu numero
    t1 += fmtDate(r.due_date); // vencimento
    t1 += padNum(r.total_amount, 13); // valor
    t1 += '30'; // dias apos venc
    t1 += padAlfa('', 6); // branco
    t1 += '01'; // especie
    t1 += 'N'; // identificacao
    t1 += padAlfa('', 6); // data emissao
    t1 += padAlfa('', 3); // branco
    t1 += '2'; // juros taxa mensal
    t1 += padNum(0, 13); // valor juros/dia
    t1 += padNum(100, 4); // 1.00%
    t1 += fmtDate(venc1dia); // data mora
    t1 += '0'; // sem desconto
    t1 += padNum(0, 13) + padNum(0, 4) + padNum(0, 6); // desconto
    t1 += padNum(0, 13); // branco
    t1 += tipoDoc; // tipo doc
    t1 += padNum(doc, 14); // CPF/CNPJ
    t1 += padAlfa(r.customers.legal_name, 40); // nome
    t1 += padAlfa((r.customers.address_street || 'NAO INFORMADO') + ' ' + (r.customers.address_number || ''), 38); // endereco
    t1 += padAlfa(r.customers.address_state || 'SP', 2); // UF
    t1 += padNum(limpar(r.customers.address_zip || '00000000'), 8); // CEP
    t1 += padAlfa(r.description || '', 70); // mensagem
    t1 += padNum(seq, 6); // seq registro
    lines.push(t1);

    console.log('Tipo 1:', t1.length, 'bytes', t1.length === 400 ? 'OK' : 'ERRO! (' + t1.length + ')');
    console.log('  R$', (r.total_amount/100).toFixed(2), '|', r.customers.legal_name.substring(0,30), '| Venc:', r.due_date.toISOString().substring(0,10));

    // TIPO 3 (email)
    if (r.customers.email) {
      seq++;
      let t3 = '3' + padAlfa(r.customers.email, 50) + padAlfa('', 10) + padAlfa('', 236) + padAlfa('', 97) + padNum(seq, 6);
      lines.push(t3);
      console.log('Tipo 3:', t3.length, 'bytes', t3.length === 400 ? 'OK' : 'ERRO!', '| Email:', r.customers.email);
    }
  }

  // TRAILER
  seq++;
  let tr = '9' + padNum(receivables.length, 6) + padAlfa('', 387) + padNum(seq, 6);
  lines.push(tr);
  console.log('Trailer:', tr.length, 'bytes', tr.length === 400 ? 'OK' : 'ERRO!');

  const conteudo = lines.join('\r\n') + '\r\n';
  const nomeArquivo = 'CI400_001_0000001.REM';
  const filePath = 'C:/Users/pontu/Downloads/' + nomeArquivo;
  fs.writeFileSync(filePath, conteudo);

  console.log('\n=== Resultado ===');
  console.log('Linhas:', lines.length);
  console.log('Boletos:', receivables.length);
  console.log('Arquivo:', filePath);
  console.log('Tamanho:', conteudo.length, 'bytes');
  console.log('\nPronto para upload no Internet Banking Inter!');
  console.log('Menu: Cobrar ou receber → Emissao via arquivo → Importar → .REM');

  await p.$disconnect();
}
main();
