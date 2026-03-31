/**
 * Migração COMPLETA VHSys → PontualERP
 * Todas as OS desde 01/01/2025 com itens/serviços
 *
 * Etapas:
 * 1. Download: OS em lotes de 250 via proxy Vercel (gru1)
 * 2. Download: Clientes únicos
 * 3. Download: Itens (produtos + serviços) de cada OS com valor
 * 4. Insert: Clientes → OS → Itens → Histórico
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();
const COMPANY_ID = 'pontualtech-001';
const PROXY_URL = 'https://vhsys-proxy.vercel.app/api/migracao-os';
const CUTOFF_DATE = '2025-01-01';
const CACHE_DIR = './migration-cache';

// ====== DOWNLOAD ======

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      console.log(`  Retry ${i + 1}: HTTP ${r.status}`);
    } catch (e) {
      console.log(`  Retry ${i + 1}: ${e.message}`);
    }
    await new Promise(ok => setTimeout(ok, 2000 * (i + 1)));
  }
  return null;
}

async function downloadAllOS() {
  const cacheFile = `${CACHE_DIR}/all-os.json`;
  if (fs.existsSync(cacheFile)) {
    console.log('  Cache encontrado, carregando...');
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  }

  const allOS = [];
  let offset = 0;
  let keepGoing = true;

  while (keepGoing) {
    console.log(`  Buscando OS offset=${offset}...`);
    const result = await fetchJSON(`${PROXY_URL}?action=os&limit=250&offset=${offset}`);
    if (!result || !result.data || result.data.length === 0) {
      console.log('  Fim dos dados ou erro.');
      break;
    }

    for (const os of result.data) {
      const osDate = os.data_cad_pedido?.substring(0, 10);
      if (osDate && osDate < CUTOFF_DATE) {
        keepGoing = false;
        break;
      }
      allOS.push(os);
    }

    console.log(`  Lote: ${result.data.length} OS, total acumulado: ${allOS.length}`);
    offset += 250;

    // Rate limit entre lotes
    await new Promise(ok => setTimeout(ok, 1000));
  }

  fs.writeFileSync(cacheFile, JSON.stringify(allOS));
  return allOS;
}

async function downloadClients(clientIds) {
  const cacheFile = `${CACHE_DIR}/all-clients.json`;
  if (fs.existsSync(cacheFile)) {
    console.log('  Cache encontrado, carregando...');
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  }

  const allClients = [];
  const batchSize = 15;
  const totalBatches = Math.ceil(clientIds.length / batchSize);

  for (let i = 0; i < clientIds.length; i += batchSize) {
    const batch = clientIds.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} clientes)...`);

    const result = await fetchJSON(`${PROXY_URL}?action=clientes&ids=${batch.join(',')}`);
    if (result?.data) {
      allClients.push(...result.data);
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(allClients));
  return allClients;
}

async function downloadOSItems(osList) {
  const cacheFile = `${CACHE_DIR}/all-items.json`;
  if (fs.existsSync(cacheFile)) {
    console.log('  Cache encontrado, carregando...');
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  }

  // Filtrar OS com valor > 0
  const osWithValue = osList.filter(o => parseFloat(o.valor_total_os || '0') > 0);
  console.log(`  OS com valor > 0: ${osWithValue.length} de ${osList.length}`);

  const allItems = {};
  const batchSize = 10;
  const totalBatches = Math.ceil(osWithValue.length / batchSize);

  for (let i = 0; i < osWithValue.length; i += batchSize) {
    const batch = osWithValue.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const ids = batch.map(o => o.id_ordem).join(',');

    if (batchNum % 10 === 0 || batchNum === 1) {
      console.log(`  Batch ${batchNum}/${totalBatches}...`);
    }

    const result = await fetchJSON(`${PROXY_URL}?action=os-itens-batch&ids=${ids}`);
    if (result?.data) {
      Object.assign(allItems, result.data);
    }

    // Rate limit
    await new Promise(ok => setTimeout(ok, 500));
  }

  fs.writeFileSync(cacheFile, JSON.stringify(allItems));
  console.log(`  Total OS com itens: ${Object.keys(allItems).length}`);
  return allItems;
}

// ====== MAPPING ======

let STATUS_MAP = {};
let DEFAULT_STATUS_ID = '';

async function loadStatusMap() {
  const statuses = await prisma.moduleStatus.findMany({
    where: { company_id: COMPANY_ID, module: 'os' },
  });
  const nameMap = {};
  for (const s of statuses) {
    nameMap[s.name.toLowerCase()] = s.id;
    if (s.is_default) DEFAULT_STATUS_ID = s.id;
  }
  STATUS_MAP = {
    'Em Aberto': nameMap['aberta'] || nameMap['orcar'] || DEFAULT_STATUS_ID,
    'Em Andamento': nameMap['em execucao'] || DEFAULT_STATUS_ID,
    'Finalizado': nameMap['pronta'] || nameMap['entregue'] || DEFAULT_STATUS_ID,
    'Cancelado': nameMap['cancelada'] || DEFAULT_STATUS_ID,
    'Faturado': nameMap['entregue'] || DEFAULT_STATUS_ID,
    'Aprovado': nameMap['aprovado'] || nameMap['em execucao'] || DEFAULT_STATUS_ID,
  };
  console.log('Status map:', Object.entries(STATUS_MAP).map(([k, v]) => {
    const n = statuses.find(s => s.id === v)?.name;
    return `${k}→${n}`;
  }).join(', '));
}

function mapStatus(vhsysStatus) {
  return STATUS_MAP[vhsysStatus] || DEFAULT_STATUS_ID;
}

function parseDecimalToCents(val) {
  if (!val || val === '0.00' || val === '0') return 0;
  const num = parseFloat(String(val).replace(',', '.'));
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === '0000-00-00' || dateStr === '0000-00-00 00:00:00') return null;
  const d = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('T') ? '' : dateStr.includes(' ') ? '' : 'T00:00:00'));
  return isNaN(d.getTime()) ? null : d;
}

function mapClient(vc) {
  const isPJ = vc.tipo_pessoa === 'PJ';
  return {
    company_id: COMPANY_ID,
    vhsys_id: String(vc.id_cliente),
    legal_name: (vc.razao_cliente || 'SEM NOME').trim(),
    trade_name: (vc.fantasia_cliente || '').trim() || null,
    person_type: isPJ ? 'JURIDICA' : 'FISICA',
    customer_type: 'CLIENTE',
    document_number: (vc.cnpj_cliente || '').replace(/[.\-\/]/g, '').trim() || null,
    email: (vc.email_cliente || '').trim() || null,
    phone: (vc.fone_cliente || '').trim() || null,
    mobile: (vc.celular_cliente || '').trim() || null,
    address_street: (vc.endereco_cliente || '').trim() || null,
    address_number: (vc.numero_cliente || '').trim() || null,
    address_complement: (vc.complemento_cliente || '').trim() || null,
    address_neighborhood: (vc.bairro_cliente || '').trim() || null,
    address_city: (vc.cidade_cliente || '').trim() || null,
    address_state: (vc.uf_cliente || '').trim() || null,
    address_zip: (vc.cep_cliente || '').replace(/[.\-]/g, '').trim() || null,
    state_registration: (vc.insc_estadual_cliente || '').trim() || null,
    notes: (vc.observacoes_cliente || '').trim() || null,
    custom_data: {
      vhsys_id_registro: vc.id_registro,
      vhsys_contato: vc.contato_cliente,
      vhsys_data_cad: vc.data_cad_cliente,
    },
  };
}

function extractEquipment(os) {
  const equip = (os.equipamento_ordem || '').trim();
  const parts = equip.split(/\s+/);
  if (parts.length >= 2) {
    return { type: equip, brand: parts[0], model: parts.slice(1).join(' ') };
  }
  return { type: equip || 'Impressora', brand: null, model: null };
}

function mapOS(vos, customerIdMap) {
  const customerId = customerIdMap[String(vos.id_cliente)];
  if (!customerId) return null;

  const equip = extractEquipment(vos);
  const totalServicos = parseDecimalToCents(vos.valor_total_servicos);
  const totalPecas = parseDecimalToCents(vos.valor_total_pecas);
  const totalDespesas = parseDecimalToCents(vos.valor_total_despesas);
  const totalDesconto = parseDecimalToCents(vos.valor_total_desconto);
  const totalOS = parseDecimalToCents(vos.valor_total_os);
  const createdAt = parseDate(vos.data_cad_pedido);
  const deliveryDate = parseDate(vos.data_entrega);
  const realizationDate = parseDate(vos.data_realizacao);

  return {
    company_id: COMPANY_ID,
    vhsys_id: String(vos.id_ordem),
    os_number: vos.id_pedido,
    customer_id: customerId,
    technician_id: null,
    status_id: mapStatus(vos.status_pedido),
    priority: 'MEDIUM',
    os_type: vos.tipo_atendimento === 1 ? 'BALCAO' : 'COLETA',
    equipment_type: equip.type,
    equipment_brand: equip.brand,
    equipment_model: equip.model,
    serial_number: null,
    reported_issue: (vos.problema_ordem || 'Sem descrição').trim(),
    diagnosis: (vos.laudo_ordem || '').trim() || null,
    reception_notes: (vos.recebimento_ordem || '').trim() || null,
    internal_notes: (vos.obs_interno_pedido || '').trim() || null,
    estimated_cost: totalOS || (totalServicos + totalPecas),
    approved_cost: (vos.status_pedido === 'Finalizado' || vos.status_pedido === 'Faturado') ? totalOS : 0,
    total_parts: totalPecas,
    total_services: totalServicos,
    total_cost: totalOS || (totalServicos + totalPecas - totalDesconto + totalDespesas),
    warranty_until: null,
    estimated_delivery: deliveryDate,
    actual_delivery: vos.status_pedido === 'Faturado' ? (deliveryDate || realizationDate) : null,
    custom_data: {
      vhsys_id_ordem: vos.id_ordem,
      vhsys_id_pedido: vos.id_pedido,
      vhsys_referencia: vos.referencia_ordem,
      vhsys_obs_pedido: vos.obs_pedido,
      vhsys_garantia: vos.garantia_ordem,
      vhsys_tipo_servico: vos.tipo_servico,
      vhsys_nome_tecnico: vos.nome_tecnico,
      migrated_from: 'vhsys',
      migrated_at: new Date().toISOString(),
    },
    created_at: createdAt || new Date(),
    updated_at: parseDate(vos.data_mod_pedido) || createdAt || new Date(),
  };
}

function mapOSItems(osId, companyId, vhsysItems) {
  const items = [];

  // Produtos (peças)
  for (const p of (vhsysItems.produtos || [])) {
    items.push({
      company_id: companyId,
      service_order_id: osId,
      item_type: 'PECA',
      product_id: null,
      description: (p.desc_produto || p.desc_servico || 'Peça').trim(),
      quantity: parseInt(p.quantidade || p.horas_servico || '1') || 1,
      unit_price: parseDecimalToCents(p.valor_unit_produto || p.valor_unit_servico),
      total_price: parseDecimalToCents(p.valor_total_produto || p.valor_total_servico),
    });
  }

  // Serviços
  for (const s of (vhsysItems.servicos || [])) {
    items.push({
      company_id: companyId,
      service_order_id: osId,
      item_type: 'SERVICO',
      product_id: null,
      description: (s.desc_servico || 'Serviço').trim(),
      quantity: parseInt(s.horas_servico || '1') || 1,
      unit_price: parseDecimalToCents(s.valor_unit_servico),
      total_price: parseDecimalToCents(s.valor_total_servico),
    });
  }

  return items;
}

// ====== MAIN ======

async function main() {
  console.log('=== Migração COMPLETA VHSys → PontualERP ===');
  console.log(`Desde: ${CUTOFF_DATE}\n`);

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  await loadStatusMap();

  // 1. Download OS
  console.log('\n--- Etapa 1: Download OS ---');
  const allOS = await downloadAllOS();
  console.log(`Total OS desde ${CUTOFF_DATE}: ${allOS.length}`);
  console.log(`Range: #${allOS[allOS.length - 1]?.id_pedido} - #${allOS[0]?.id_pedido}`);

  // 2. Download Clientes
  console.log('\n--- Etapa 2: Download Clientes ---');
  const clientIds = [...new Set(allOS.map(o => o.id_cliente).filter(id => id > 0))];
  console.log(`Clientes únicos: ${clientIds.length}`);
  const allClients = await downloadClients(clientIds);
  console.log(`Clientes baixados: ${allClients.length}`);

  // 3. Download Itens
  console.log('\n--- Etapa 3: Download Itens de OS ---');
  const allItems = await downloadOSItems(allOS);
  console.log(`OS com itens: ${Object.keys(allItems).length}`);

  // 4. Insert Clientes
  console.log('\n--- Etapa 4: Inserir Clientes ---');
  const customerIdMap = {};
  let cCreated = 0, cUpdated = 0, cError = 0;

  for (const vc of allClients) {
    const mapped = mapClient(vc);
    try {
      const existing = await prisma.customer.findFirst({
        where: { company_id: COMPANY_ID, vhsys_id: String(vc.id_cliente) },
      });
      if (existing) {
        await prisma.customer.update({ where: { id: existing.id }, data: {
          legal_name: mapped.legal_name, trade_name: mapped.trade_name,
          document_number: mapped.document_number, email: mapped.email,
          phone: mapped.phone, mobile: mapped.mobile,
          address_street: mapped.address_street, address_number: mapped.address_number,
          address_complement: mapped.address_complement, address_neighborhood: mapped.address_neighborhood,
          address_city: mapped.address_city, address_state: mapped.address_state,
          address_zip: mapped.address_zip,
        }});
        customerIdMap[String(vc.id_cliente)] = existing.id;
        cUpdated++;
      } else {
        const created = await prisma.customer.create({ data: mapped });
        customerIdMap[String(vc.id_cliente)] = created.id;
        cCreated++;
      }
    } catch (e) {
      console.error(`  Erro cliente ${vc.id_cliente}: ${e.message.substring(0, 80)}`);
      cError++;
    }
  }
  console.log(`  Criados: ${cCreated}, Atualizados: ${cUpdated}, Erros: ${cError}`);

  // 5. Insert OS + Itens
  console.log('\n--- Etapa 5: Inserir OS + Itens ---');
  const existingOS = await prisma.serviceOrder.findMany({
    where: { company_id: COMPANY_ID },
    select: { os_number: true, vhsys_id: true, id: true },
  });
  const existingOSNumbers = new Set(existingOS.map(o => o.os_number));
  const existingVhsysIds = new Map(existingOS.filter(o => o.vhsys_id).map(o => [o.vhsys_id, o.id]));
  console.log(`  OS existentes: ${existingOS.length}`);

  let osCreated = 0, osUpdated = 0, osSkipped = 0, osError = 0;
  let itemsCreated = 0;

  // Processar do mais antigo para o mais recente
  const sortedOS = [...allOS].reverse();

  for (const vos of sortedOS) {
    const mapped = mapOS(vos, customerIdMap);
    if (!mapped) { osSkipped++; continue; }

    try {
      // Já existe por vhsys_id?
      const existingId = existingVhsysIds.get(String(vos.id_ordem));
      if (existingId) {
        // Atualizar
        await prisma.serviceOrder.update({ where: { id: existingId }, data: {
          status_id: mapped.status_id, reported_issue: mapped.reported_issue,
          diagnosis: mapped.diagnosis, internal_notes: mapped.internal_notes,
          total_cost: mapped.total_cost, total_parts: mapped.total_parts,
          total_services: mapped.total_services, estimated_cost: mapped.estimated_cost,
          custom_data: mapped.custom_data,
        }});

        // Inserir itens se não existem
        const existingItems = await prisma.serviceOrderItem.count({
          where: { service_order_id: existingId },
        });
        if (existingItems === 0 && allItems[String(vos.id_ordem)]) {
          const items = mapOSItems(existingId, COMPANY_ID, allItems[String(vos.id_ordem)]);
          for (const item of items) {
            await prisma.serviceOrderItem.create({ data: item });
            itemsCreated++;
          }
        }

        osUpdated++;
        continue;
      }

      // Conflito de os_number?
      if (existingOSNumbers.has(mapped.os_number)) { osSkipped++; continue; }

      // Criar OS
      const created = await prisma.serviceOrder.create({ data: mapped });

      // Inserir itens
      const osItems = allItems[String(vos.id_ordem)];
      if (osItems) {
        const items = mapOSItems(created.id, COMPANY_ID, osItems);
        for (const item of items) {
          await prisma.serviceOrderItem.create({ data: item });
          itemsCreated++;
        }
      }

      // Histórico
      await prisma.serviceOrderHistory.create({ data: {
        company_id: COMPANY_ID,
        service_order_id: created.id,
        from_status_id: null,
        to_status_id: mapped.status_id,
        changed_by: 'MIGRACAO_VHSYS',
        notes: `Migrado do VHSys (OS #${vos.id_pedido}, status: ${vos.status_pedido})`,
        created_at: mapped.created_at,
      }});

      // Atualizar contador do cliente
      await prisma.customer.update({ where: { id: mapped.customer_id }, data: {
        total_os: { increment: 1 }, last_os_at: mapped.created_at,
      }});

      existingOSNumbers.add(mapped.os_number);
      osCreated++;

      if (osCreated % 100 === 0) {
        console.log(`  Progresso: ${osCreated} OS criadas, ${itemsCreated} itens...`);
      }
    } catch (e) {
      console.error(`  Erro OS ${vos.id_pedido}: ${e.message.substring(0, 100)}`);
      osError++;
    }
  }

  // 6. Resumo
  const totalOS = await prisma.serviceOrder.count({ where: { company_id: COMPANY_ID } });
  const totalCustomers = await prisma.customer.count({ where: { company_id: COMPANY_ID } });
  const totalItems = await prisma.serviceOrderItem.count();
  const maxOS = await prisma.serviceOrder.aggregate({ where: { company_id: COMPANY_ID }, _max: { os_number: true } });

  console.log(`\n=== Migração Concluída ===`);
  console.log(`OS criadas: ${osCreated} | atualizadas: ${osUpdated} | ignoradas: ${osSkipped} | erros: ${osError}`);
  console.log(`Itens de serviço criados: ${itemsCreated}`);
  console.log(`Total no ERP: ${totalOS} OS | ${totalCustomers} clientes | ${totalItems} itens`);
  console.log(`Próxima OS: #${(maxOS._max.os_number || 0) + 1}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
