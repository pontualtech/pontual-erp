/**
 * Migração VHSys → PontualERP — Contas a Receber e Contas a Pagar
 * Desde 01/01/2025, com vínculo a OS quando possível
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();
const COMPANY_ID = 'pontualtech-001';
const PROXY_URL = 'https://vhsys-proxy.vercel.app/api/migracao-os';
const CUTOFF_DATE = '2025-01-01';
const CACHE_DIR = './migration-cache';

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise(ok => setTimeout(ok, 2000 * (i + 1)));
  }
  return null;
}

function parseDecimalToCents(val) {
  if (!val || val === '0.00' || val === '0') return 0;
  return Math.round(parseFloat(String(val).replace(',', '.')) * 100) || 0;
}

function parseDate(d) {
  if (!d || d === '0000-00-00') return null;
  const dt = new Date(d.includes('T') ? d : d + 'T00:00:00');
  return isNaN(dt.getTime()) ? null : dt;
}

async function downloadAll(action, label, dateField = 'data_emissao') {
  const cacheFile = `${CACHE_DIR}/${action}-2025.json`;
  if (fs.existsSync(cacheFile)) {
    console.log(`  [${label}] Cache encontrado`);
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  }

  // Baixar TUDO (dados não vêm em ordem cronológica) e filtrar por data
  const all = [];
  let offset = 0;
  let totalExpected = 0;
  while (true) {
    const result = await fetchJSON(`${PROXY_URL}?action=${action}&limit=250&offset=${offset}`);
    if (!result?.data?.length) break;
    if (!totalExpected) totalExpected = result.total || 0;
    all.push(...result.data);
    console.log(`  [${label}] offset=${offset}, baixados=${all.length}/${totalExpected}`);
    offset += 250;
    if (all.length >= totalExpected) break;
    await new Promise(ok => setTimeout(ok, 500));
  }

  // Filtrar desde 2025
  const filtered = all.filter(item => {
    const dt = item[dateField] || item.data_emissao || item.data_cad_rec || item.data_cad_pag || '';
    return dt && dt.substring(0, 10) >= CUTOFF_DATE;
  });

  console.log(`  [${label}] Total baixados: ${all.length}, filtrados (>=${CUTOFF_DATE}): ${filtered.length}`);
  fs.writeFileSync(cacheFile, JSON.stringify(filtered));
  return filtered;
}

async function main() {
  console.log('=== Migração Financeira VHSys → PontualERP ===\n');
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Buscar mapa de clientes (vhsys_id → erp_id)
  const customers = await prisma.customer.findMany({
    where: { company_id: COMPANY_ID, vhsys_id: { not: null } },
    select: { id: true, vhsys_id: true },
  });
  const customerMap = {};
  for (const c of customers) customerMap[c.vhsys_id] = c.id;
  console.log('Clientes mapeados:', Object.keys(customerMap).length);

  // Buscar mapa de OS (vhsys os number → erp id)
  const allOS = await prisma.serviceOrder.findMany({
    where: { company_id: COMPANY_ID },
    select: { id: true, os_number: true },
  });
  const osMap = {};
  for (const os of allOS) osMap[os.os_number] = os.id;
  console.log('OS mapeadas:', Object.keys(osMap).length);

  // ====== CONTAS A RECEBER ======
  console.log('\n--- Contas a Receber ---');
  const receber = await downloadAll('contas-receber', 'Receber');
  console.log(`Total desde ${CUTOFF_DATE}: ${receber.length}`);

  let rcCreated = 0, rcUpdated = 0, rcSkipped = 0;
  for (const r of receber) {
    const vhsysId = String(r.id_conta_rec);

    // Já existe?
    const existing = await prisma.accountReceivable.findFirst({
      where: { company_id: COMPANY_ID, vhsys_id: vhsysId },
    });
    if (existing) { rcUpdated++; continue; }

    // Mapear cliente
    const customerId = r.id_cliente ? customerMap[String(r.id_cliente)] : null;

    // Tentar vincular a OS pelo campo identificacao (ex: "OS_53918") ou n_documento_rec
    let serviceOrderId = null;
    if (r.identificacao) {
      const osMatch = r.identificacao.match(/OS[_-]?(\d+)/i);
      if (osMatch) serviceOrderId = osMap[parseInt(osMatch[1])] || null;
    }
    if (!serviceOrderId && r.n_documento_rec) {
      const docMatch = r.n_documento_rec.match(/^(\d+)/);
      if (docMatch) serviceOrderId = osMap[parseInt(docMatch[1])] || null;
    }

    const isLiquidado = r.liquidado_rec === 'Sim';
    const valor = parseDecimalToCents(r.valor_rec);
    const valorPago = parseDecimalToCents(r.valor_pago);
    const vencimento = parseDate(r.vencimento_rec);
    if (!vencimento) { rcSkipped++; continue; }

    try {
      await prisma.accountReceivable.create({
        data: {
          company_id: COMPANY_ID,
          vhsys_id: vhsysId,
          customer_id: customerId,
          service_order_id: serviceOrderId,
          description: r.nome_conta || 'Conta a Receber VHSys',
          total_amount: valor,
          received_amount: isLiquidado ? (valorPago || valor) : 0,
          due_date: vencimento,
          status: isLiquidado ? 'RECEBIDO' : 'PENDENTE',
          payment_method: r.forma_pagamento || null,
          notes: [r.observacoes_rec, r.obs_pagamento].filter(Boolean).join(' | ') || null,
          created_at: parseDate(r.data_cad_rec) || vencimento,
        },
      });
      rcCreated++;
      if (rcCreated % 500 === 0) console.log(`  Progresso: ${rcCreated} criadas...`);
    } catch (e) {
      rcSkipped++;
    }
  }
  console.log(`Receber: ${rcCreated} criadas, ${rcUpdated} existentes, ${rcSkipped} ignoradas`);

  // ====== CONTAS A PAGAR ======
  console.log('\n--- Contas a Pagar ---');

  const cacheFilePagar = `${CACHE_DIR}/contas-pagar-2025.json`;
  let pagarAll;
  if (fs.existsSync(cacheFilePagar)) {
    console.log('  [Pagar] Cache encontrado');
    pagarAll = JSON.parse(fs.readFileSync(cacheFilePagar, 'utf-8'));
  } else {
    const allPagar = [];
    let pOffset = 0;
    while (true) {
      const result = await fetchJSON(`https://vhsys-proxy.vercel.app/api/proxy?path=/v2/contas-pagar&limit=250&offset=${pOffset}&lixeira=Nao`);
      if (!result?.data?.length) break;
      allPagar.push(...result.data);
      console.log(`  [Pagar] offset=${pOffset}, baixados=${allPagar.length}/${result.paging?.total||'?'}`);
      pOffset += 250;
      if (result.paging?.total && allPagar.length >= result.paging.total) break;
      await new Promise(ok => setTimeout(ok, 500));
    }
    pagarAll = allPagar.filter(item => {
      const dt = item.data_emissao || item.data_cad_pag || '';
      return dt && dt.substring(0, 10) >= CUTOFF_DATE;
    });
    console.log(`  [Pagar] Total baixados: ${allPagar.length}, filtrados: ${pagarAll.length}`);
    fs.writeFileSync(cacheFilePagar, JSON.stringify(pagarAll));
  }
  console.log(`Total desde ${CUTOFF_DATE}: ${pagarAll.length}`);

  let apCreated = 0, apUpdated = 0, apSkipped = 0;
  for (const r of pagarAll) {
    const vhsysId = String(r.id_conta_pag);

    const existing = await prisma.accountPayable.findFirst({
      where: { company_id: COMPANY_ID, vhsys_id: vhsysId },
    });
    if (existing) { apUpdated++; continue; }

    const isLiquidado = r.liquidado_pag === 'Sim';
    const valor = parseDecimalToCents(r.valor_pag);
    const valorPago = parseDecimalToCents(r.valor_pago);
    const vencimento = parseDate(r.vencimento_pag);
    if (!vencimento) { apSkipped++; continue; }

    try {
      await prisma.accountPayable.create({
        data: {
          company_id: COMPANY_ID,
          vhsys_id: vhsysId,
          description: r.nome_conta || 'Conta a Pagar VHSys',
          total_amount: valor,
          paid_amount: isLiquidado ? (valorPago || valor) : 0,
          due_date: vencimento,
          status: isLiquidado ? 'PAGO' : 'PENDENTE',
          payment_method: r.forma_pagamento || null,
          notes: [r.observacoes_pag, r.obs_pagamento, r.nome_fornecedor].filter(Boolean).join(' | ') || null,
          created_at: parseDate(r.data_cad_pag) || vencimento,
        },
      });
      apCreated++;
      if (apCreated % 500 === 0) console.log(`  Progresso: ${apCreated} criadas...`);
    } catch (e) {
      apSkipped++;
    }
  }
  console.log(`Pagar: ${apCreated} criadas, ${apUpdated} existentes, ${apSkipped} ignoradas`);

  // Resumo
  const totalAR = await prisma.accountReceivable.count({ where: { company_id: COMPANY_ID } });
  const totalAP = await prisma.accountPayable.count({ where: { company_id: COMPANY_ID } });
  console.log(`\n=== Migração Concluída ===`);
  console.log(`Contas a Receber: ${totalAR}`);
  console.log(`Contas a Pagar: ${totalAP}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
