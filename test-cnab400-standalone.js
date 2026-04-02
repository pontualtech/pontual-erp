/**
 * Teste standalone CNAB 400 Inter — sem banco de dados
 * Gera arquivo .REM de exemplo e valida layout posicional
 */

function padNum(v, len) { return String(v).padStart(len, '0').substring(0, len); }
function padAlfa(v, len) { return v.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').substring(0, len).padEnd(len, ' '); }
function fmtDate(d) { return d.getDate().toString().padStart(2,'0') + (d.getMonth()+1).toString().padStart(2,'0') + d.getFullYear().toString().substring(2); }
function limpar(doc) { return doc.replace(/[.\-\/]/g, ''); }

const now = new Date();
const venc1 = new Date('2026-04-15');
const venc1dia1 = new Date(venc1); venc1dia1.setDate(venc1dia1.getDate() + 1);
const venc2 = new Date('2026-04-20');
const venc2dia1 = new Date(venc2); venc2dia1.setDate(venc2dia1.getDate() + 1);

let seq = 1;
const lines = [];

// ====== HEADER (tipo 0) ======
let h = '';
h += '0';                                    // 001
h += '1';                                    // 002
h += padAlfa('REMESSA', 7);                  // 003-009
h += '01';                                   // 010-011
h += padAlfa('COBRANCA', 15);               // 012-026
h += padAlfa('', 20);                       // 027-046
h += padAlfa('PONTUAL TECH SERVICOS LTDA', 30); // 047-076
h += '077';                                  // 077-079
h += padAlfa('INTER', 15);                  // 080-094
h += fmtDate(now);                          // 095-100
h += padAlfa('', 10);                       // 101-110
h += padNum(1, 7);                          // 111-117
h += padAlfa('', 277);                      // 118-394
h += padNum(seq, 6);                        // 395-400
lines.push(h);

// ====== BOLETO 1: CNPJ, R$ 350,00 ======
seq++;
let t1 = '';
t1 += '1';                                   // 001
t1 += padAlfa('', 19);                      // 002-020
t1 += '112';                                // 021-023 carteira
t1 += padNum('0001', 4);                    // 024-027 agencia
t1 += padNum('004025073', 9);               // 028-036 conta
t1 += '3';                                   // 037 DV
t1 += padAlfa('REC-20260401-001', 25);      // 038-062 controle
t1 += '001';                                // 063-065 formato boleto
t1 += '2';                                   // 066 multa percentual
t1 += padNum(0, 13);                        // 067-079 valor multa
t1 += padNum(200, 4);                       // 080-083 2.00%
t1 += fmtDate(venc1dia1);                   // 084-089 data multa
t1 += padNum(0, 11);                        // 090-100 nosso numero (zeros=112)
t1 += padAlfa('', 8);                       // 101-108
t1 += '01';                                  // 109-110 ocorrencia remessa
t1 += padAlfa('REC-001', 10);              // 111-120 seu numero
t1 += fmtDate(venc1);                       // 121-126 vencimento
t1 += padNum(35000, 13);                    // 127-139 R$ 350,00
t1 += '30';                                  // 140-141 dias apos venc
t1 += padAlfa('', 6);                       // 142-147
t1 += '01';                                  // 148-149 especie DM
t1 += 'N';                                   // 150
t1 += padAlfa('', 6);                       // 151-156
t1 += padAlfa('', 3);                       // 157-159
t1 += '2';                                   // 160 juros taxa mensal
t1 += padNum(0, 13);                        // 161-173 valor/dia
t1 += padNum(100, 4);                       // 174-177 1.00% a.m.
t1 += fmtDate(venc1dia1);                   // 178-183 data mora
t1 += '0';                                   // 184 sem desconto
t1 += padNum(0, 13);                        // 185-197
t1 += padNum(0, 4);                         // 198-201
t1 += padNum(0, 6);                         // 202-207
t1 += padNum(0, 13);                        // 208-220
t1 += '02';                                  // 221-222 CNPJ
t1 += padNum('32772178000147', 14);          // 223-236
t1 += padAlfa('EMPRESA EXEMPLO COMERCIO LTDA', 40); // 237-276
t1 += padAlfa('RUA DAS FLORES 123 CENTRO', 38);     // 277-314
t1 += padAlfa('SP', 2);                     // 315-316
t1 += padNum('01310100', 8);                // 317-324
t1 += padAlfa('COBRANCA REF OS 1234 - MANUTENCAO IMPRESSORA', 70); // 325-394
t1 += padNum(seq, 6);                       // 395-400
lines.push(t1);

// ====== EMAIL BOLETO 1 (tipo 3) ======
seq++;
let t3 = '';
t3 += '3';                                   // 001
t3 += padAlfa('financeiro@empresaexemplo.com.br', 50); // 002-051
t3 += padAlfa('', 10);                      // 052-061
t3 += padAlfa('', 236);                     // 062-297
t3 += padAlfa('', 97);                      // 298-394
t3 += padNum(seq, 6);                       // 395-400
lines.push(t3);

// ====== BOLETO 2: CPF, R$ 1.285,00 ======
seq++;
let t2 = '';
t2 += '1';
t2 += padAlfa('', 19);
t2 += '112';
t2 += padNum('0001', 4);
t2 += padNum('004025073', 9);
t2 += '3';
t2 += padAlfa('REC-20260401-002', 25);
t2 += '001';
t2 += '2' + padNum(0, 13) + padNum(200, 4) + fmtDate(venc2dia1);
t2 += padNum(0, 11) + padAlfa('', 8);
t2 += '01' + padAlfa('REC-002', 10) + fmtDate(venc2) + padNum(128500, 13) + '30';
t2 += padAlfa('', 6) + '01' + 'N' + padAlfa('', 6) + padAlfa('', 3);
t2 += '2' + padNum(0, 13) + padNum(100, 4) + fmtDate(venc2dia1);
t2 += '0' + padNum(0, 13) + padNum(0, 4) + padNum(0, 6) + padNum(0, 13);
t2 += '01' + padNum('12345678901', 14);
t2 += padAlfa('JOAO DA SILVA', 40);
t2 += padAlfa('AV PAULISTA 1000 SALA 501', 38);
t2 += padAlfa('SP', 2) + padNum('01310000', 8);
t2 += padAlfa('SERVICO ASSISTENCIA TECNICA - CONTRATO MENSAL', 70);
t2 += padNum(seq, 6);
lines.push(t2);

// ====== TRAILER (tipo 9) ======
seq++;
let tr = '';
tr += '9';                                   // 001
tr += padNum(2, 6);                          // 002-007 qtd boletos
tr += padAlfa('', 387);                     // 008-394
tr += padNum(seq, 6);                       // 395-400
lines.push(tr);

// ====== VALIDACAO ======
console.log('');
console.log('\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557');
console.log('\u2551     TESTE CNAB 400 \u2014 BANCO INTER (077) \u2014 LAYOUT V7        \u2551');
console.log('\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D');
console.log('');

let allOk = true;
const labels = ['HEADER  (tipo 0)', 'BOLETO 1 (tipo 1)', 'EMAIL 1  (tipo 3)', 'BOLETO 2 (tipo 1)', 'TRAILER  (tipo 9)'];
lines.forEach((l, i) => {
  const ok = l.length === 400;
  if (!ok) allOk = false;
  console.log(`  ${ok ? '\u2705' : '\u274C'} ${labels[i]}: ${l.length} bytes ${ok ? '' : '(ESPERADO 400!)'}`);
});

console.log('');

// ====== DETALHES BOLETO 1 ======
const b1 = lines[1];
console.log('\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
console.log('\u2502  BOLETO 1 \u2014 EMPRESA EXEMPLO COMERCIO LTDA              \u2502');
console.log('\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524');
console.log(`\u2502  Carteira:    ${b1.substring(20, 23)}                                             \u2502`);
console.log(`\u2502  Agencia:     ${b1.substring(23, 27)}                                            \u2502`);
console.log(`\u2502  Conta:       ${b1.substring(27, 36)}-${b1[36]}                                      \u2502`);
console.log(`\u2502  Controle:    ${b1.substring(37, 62).trim().padEnd(44)} \u2502`);
console.log(`\u2502  Formato:     ${b1.substring(62, 65)} (boleto)                                    \u2502`);
console.log(`\u2502  Multa:       ${b1[65]} = ${(parseInt(b1.substring(79,83))/100).toFixed(2)}% apos ${b1.substring(83, 89)}                       \u2502`);
console.log(`\u2502  Ocorrencia:  ${b1.substring(108, 110)} (01=Remessa)                                \u2502`);
console.log(`\u2502  Seu Numero:  ${b1.substring(110, 120).trim().padEnd(44)} \u2502`);
console.log(`\u2502  Vencimento:  ${b1.substring(120, 126)}                                          \u2502`);
console.log(`\u2502  Valor:       R$ ${(parseInt(b1.substring(126, 139))/100).toFixed(2).padEnd(41)} \u2502`);
console.log(`\u2502  Dias Apos:   ${b1.substring(139, 141)}                                              \u2502`);
console.log(`\u2502  Juros:       ${b1[159]} = ${(parseInt(b1.substring(173,177))/100).toFixed(2)}% a.m. apos ${b1.substring(177, 183)}                  \u2502`);
console.log(`\u2502  Tipo Doc:    ${b1.substring(220, 222)} (02=CNPJ)                                   \u2502`);
console.log(`\u2502  CNPJ:        ${b1.substring(222, 236).trim().padEnd(44)} \u2502`);
console.log(`\u2502  Pagador:     ${b1.substring(236, 276).trim().padEnd(44)} \u2502`);
console.log(`\u2502  Endereco:    ${b1.substring(276, 314).trim().padEnd(44)} \u2502`);
console.log(`\u2502  UF:          ${b1.substring(314, 316)}                                              \u2502`);
console.log(`\u2502  CEP:         ${b1.substring(316, 324)}                                          \u2502`);
console.log(`\u2502  Mensagem:    ${b1.substring(324, 394).trim().substring(0, 44).padEnd(44)} \u2502`);
console.log('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');

console.log('');

// ====== DETALHES BOLETO 2 ======
const b2 = lines[3];
console.log('\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
console.log('\u2502  BOLETO 2 \u2014 JOAO DA SILVA (CPF)                         \u2502');
console.log('\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524');
console.log(`\u2502  Seu Numero:  ${b2.substring(110, 120).trim().padEnd(44)} \u2502`);
console.log(`\u2502  Vencimento:  ${b2.substring(120, 126)}                                          \u2502`);
console.log(`\u2502  Valor:       R$ ${(parseInt(b2.substring(126, 139))/100).toFixed(2).padEnd(41)} \u2502`);
console.log(`\u2502  Tipo Doc:    ${b2.substring(220, 222)} (01=CPF)                                    \u2502`);
console.log(`\u2502  CPF:         ${b2.substring(222, 236).trim().padEnd(44)} \u2502`);
console.log(`\u2502  Pagador:     ${b2.substring(236, 276).trim().padEnd(44)} \u2502`);
console.log(`\u2502  Endereco:    ${b2.substring(276, 314).trim().padEnd(44)} \u2502`);
console.log(`\u2502  Mensagem:    ${b2.substring(324, 394).trim().substring(0, 44).padEnd(44)} \u2502`);
console.log('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');

console.log('');

// ====== EMAIL ======
const email = lines[2];
console.log('\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510');
console.log('\u2502  TIPO 3 \u2014 EMAIL DO PAGADOR                              \u2502');
console.log('\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524');
console.log(`\u2502  Email:       ${email.substring(1, 51).trim().padEnd(44)} \u2502`);
console.log(`\u2502  (Inter envia boleto PDF automaticamente!)                \u2502`);
console.log('\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518');

console.log('');
if (allOk) {
  console.log('\u2705 TODOS OS REGISTROS COM 400 BYTES \u2014 LAYOUT VALIDO!');
} else {
  console.log('\u274C ERRO: Algum registro nao tem 400 bytes!');
}

// Salvar arquivo
const fs = require('fs');
const conteudo = lines.join('\r\n') + '\r\n';
fs.writeFileSync('C:/Users/pontu/Downloads/CI400_001_0000001_TESTE.REM', conteudo);
console.log('');
console.log('Arquivo salvo: C:\\Users\\pontu\\Downloads\\CI400_001_0000001_TESTE.REM');
console.log('Tamanho: ' + conteudo.length + ' bytes (' + lines.length + ' linhas)');
console.log('');
console.log('Para usar em producao:');
console.log('  Internet Banking Inter > Cobrar > Emissao via arquivo > Importar .REM');
