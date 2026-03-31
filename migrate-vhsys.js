/**
 * Migração VHSys → PontualERP
 *
 * Importa as últimas 250 OS do VHSys com:
 * - Clientes (upsert por vhsys_id)
 * - OS com número original clonado
 * - Histórico de status inicial
 * - Itens de OS (serviços/peças com valores)
 *
 * Dados fonte: migration-os-raw.json + migration-clients-raw.json
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();
const COMPANY_ID = 'pontualtech-001';

// Mapeamento será carregado dinamicamente do banco
let STATUS_MAP = {};
let DEFAULT_STATUS_ID = '';

// Mapeamento de tipo_atendimento VHSys → os_type ERP
const TYPE_MAP = {
  0: 'COLETA',      // Coleta/entrega
  1: 'BALCAO',      // Balcão
  2: 'COLETA',      // Campo
};

async function loadStatusMap() {
  const statuses = await prisma.moduleStatus.findMany({
    where: { company_id: COMPANY_ID, module: 'os' },
  });
  // Mapear nomes VHSys para IDs do ERP
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

  console.log('Status map loaded:');
  for (const [k, v] of Object.entries(STATUS_MAP)) {
    const name = statuses.find(s => s.id === v)?.name || '?';
    console.log(`  ${k} → ${name} (${v})`);
  }
  console.log(`  Default → ${statuses.find(s => s.id === DEFAULT_STATUS_ID)?.name} (${DEFAULT_STATUS_ID})\n`);
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

function mapClient(vhsysClient) {
  const isPJ = vhsysClient.tipo_pessoa === 'PJ';
  return {
    company_id: COMPANY_ID,
    vhsys_id: String(vhsysClient.id_cliente),
    legal_name: (vhsysClient.razao_cliente || 'SEM NOME').trim(),
    trade_name: (vhsysClient.fantasia_cliente || '').trim() || null,
    person_type: isPJ ? 'JURIDICA' : 'FISICA',
    customer_type: 'CLIENTE',
    document_number: (vhsysClient.cnpj_cliente || '').replace(/[.\-\/]/g, '').trim() || null,
    email: (vhsysClient.email_cliente || '').trim() || null,
    phone: (vhsysClient.fone_cliente || '').trim() || null,
    mobile: (vhsysClient.celular_cliente || '').trim() || null,
    address_street: (vhsysClient.endereco_cliente || '').trim() || null,
    address_number: (vhsysClient.numero_cliente || '').trim() || null,
    address_complement: (vhsysClient.complemento_cliente || '').trim() || null,
    address_neighborhood: (vhsysClient.bairro_cliente || '').trim() || null,
    address_city: (vhsysClient.cidade_cliente || '').trim() || null,
    address_state: (vhsysClient.uf_cliente || '').trim() || null,
    address_zip: (vhsysClient.cep_cliente || '').replace(/[.\-]/g, '').trim() || null,
    state_registration: (vhsysClient.insc_estadual_cliente || '').trim() || null,
    notes: (vhsysClient.observacoes_cliente || '').trim() || null,
    custom_data: {
      vhsys_id_registro: vhsysClient.id_registro,
      vhsys_contato: vhsysClient.contato_cliente,
      vhsys_data_cad: vhsysClient.data_cad_cliente,
    },
  };
}

function extractEquipment(os) {
  const equip = (os.equipamento_ordem || '').trim();
  // Tenta separar marca e modelo: "HP Smart 584" → brand="HP", model="Smart 584"
  // "Brother DCP-T430W" → brand="Brother", model="DCP-T430W"
  const parts = equip.split(/\s+/);
  if (parts.length >= 2) {
    return {
      type: equip,
      brand: parts[0],
      model: parts.slice(1).join(' '),
    };
  }
  return { type: equip || 'Impressora', brand: null, model: null };
}

function mapOS(vhsysOS, customerIdMap) {
  const customerId = customerIdMap[String(vhsysOS.id_cliente)];
  if (!customerId) return null;

  const equip = extractEquipment(vhsysOS);
  const totalServicos = parseDecimalToCents(vhsysOS.valor_total_servicos);
  const totalPecas = parseDecimalToCents(vhsysOS.valor_total_pecas);
  const totalDespesas = parseDecimalToCents(vhsysOS.valor_total_despesas);
  const totalDesconto = parseDecimalToCents(vhsysOS.valor_total_desconto);
  const totalOS = parseDecimalToCents(vhsysOS.valor_total_os);

  const createdAt = parseDate(vhsysOS.data_cad_pedido);
  const deliveryDate = parseDate(vhsysOS.data_entrega);
  const realizationDate = parseDate(vhsysOS.data_realizacao);

  return {
    company_id: COMPANY_ID,
    vhsys_id: String(vhsysOS.id_ordem),
    os_number: vhsysOS.id_pedido,
    customer_id: customerId,
    technician_id: null,
    status_id: mapStatus(vhsysOS.status_pedido),
    priority: 'MEDIUM',
    os_type: TYPE_MAP[vhsysOS.tipo_atendimento] || 'BALCAO',
    equipment_type: equip.type,
    equipment_brand: equip.brand,
    equipment_model: equip.model,
    serial_number: null,
    reported_issue: (vhsysOS.problema_ordem || 'Sem descrição').trim(),
    diagnosis: (vhsysOS.laudo_ordem || '').trim() || null,
    reception_notes: (vhsysOS.recebimento_ordem || '').trim() || null,
    internal_notes: (vhsysOS.obs_interno_pedido || '').trim() || null,
    estimated_cost: totalOS || (totalServicos + totalPecas),
    approved_cost: vhsysOS.status_pedido === 'Finalizado' || vhsysOS.status_pedido === 'Faturado' ? totalOS : 0,
    total_parts: totalPecas,
    total_services: totalServicos,
    total_cost: totalOS || (totalServicos + totalPecas - totalDesconto + totalDespesas),
    warranty_until: null,
    estimated_delivery: deliveryDate,
    actual_delivery: vhsysOS.status_pedido === 'Faturado' ? (deliveryDate || realizationDate) : null,
    custom_data: {
      vhsys_id_ordem: vhsysOS.id_ordem,
      vhsys_id_pedido: vhsysOS.id_pedido,
      vhsys_referencia: vhsysOS.referencia_ordem,
      vhsys_obs_pedido: vhsysOS.obs_pedido,
      vhsys_garantia: vhsysOS.garantia_ordem,
      vhsys_tipo_servico: vhsysOS.tipo_servico,
      vhsys_nome_tecnico: vhsysOS.nome_tecnico,
      migrated_from: 'vhsys',
      migrated_at: new Date().toISOString(),
    },
    created_at: createdAt || new Date(),
    updated_at: parseDate(vhsysOS.data_mod_pedido) || createdAt || new Date(),
  };
}

async function main() {
  console.log('=== Migração VHSys → PontualERP ===\n');

  // 0. Carregar mapeamento de status do banco
  await loadStatusMap();

  // 1. Carregar dados
  const osData = JSON.parse(fs.readFileSync('migration-os-raw.json', 'utf-8'));
  const clientsData = JSON.parse(fs.readFileSync('migration-clients-raw.json', 'utf-8'));

  console.log(`OS a migrar: ${osData.count}`);
  console.log(`Clientes a migrar: ${clientsData.length}`);
  console.log(`Range OS: ${osData.data[osData.count - 1].id_pedido} - ${osData.data[0].id_pedido}\n`);

  // 2. Upsert clientes
  console.log('--- Etapa 1: Clientes ---');
  const customerIdMap = {}; // vhsys_id → erp_id
  let clientsCreated = 0, clientsUpdated = 0, clientsError = 0;

  for (const vc of clientsData) {
    const mapped = mapClient(vc);
    try {
      const existing = await prisma.customer.findFirst({
        where: { company_id: COMPANY_ID, vhsys_id: String(vc.id_cliente) },
      });

      if (existing) {
        // Atualizar dados do cliente (pode ter mudado no VHSys)
        await prisma.customer.update({
          where: { id: existing.id },
          data: {
            legal_name: mapped.legal_name,
            trade_name: mapped.trade_name,
            document_number: mapped.document_number,
            email: mapped.email,
            phone: mapped.phone,
            mobile: mapped.mobile,
            address_street: mapped.address_street,
            address_number: mapped.address_number,
            address_complement: mapped.address_complement,
            address_neighborhood: mapped.address_neighborhood,
            address_city: mapped.address_city,
            address_state: mapped.address_state,
            address_zip: mapped.address_zip,
          },
        });
        customerIdMap[String(vc.id_cliente)] = existing.id;
        clientsUpdated++;
      } else {
        const created = await prisma.customer.create({ data: mapped });
        customerIdMap[String(vc.id_cliente)] = created.id;
        clientsCreated++;
      }
    } catch (e) {
      console.error(`  Erro cliente ${vc.id_cliente} (${vc.razao_cliente}): ${e.message}`);
      clientsError++;
    }
  }

  console.log(`  Criados: ${clientsCreated}`);
  console.log(`  Atualizados: ${clientsUpdated}`);
  console.log(`  Erros: ${clientsError}`);
  console.log(`  Mapeados: ${Object.keys(customerIdMap).length}\n`);

  // 3. Verificar e resolver conflitos de os_number
  console.log('--- Etapa 2: Verificar conflitos de OS ---');
  const existingOS = await prisma.serviceOrder.findMany({
    where: { company_id: COMPANY_ID },
    select: { os_number: true, vhsys_id: true, id: true },
  });
  const existingOSNumbers = new Set(existingOS.map(o => o.os_number));
  const existingVhsysIds = new Map(existingOS.filter(o => o.vhsys_id).map(o => [o.vhsys_id, o.id]));
  console.log(`  OS existentes no ERP: ${existingOS.length}`);
  console.log(`  OS com vhsys_id: ${existingVhsysIds.size}\n`);

  // 4. Inserir OS
  console.log('--- Etapa 3: Migrar OS ---');
  let osCreated = 0, osUpdated = 0, osSkipped = 0, osError = 0;

  // Processar do mais antigo para o mais recente (manter ordem)
  const sortedOS = [...osData.data].reverse();

  for (const vos of sortedOS) {
    const mapped = mapOS(vos, customerIdMap);
    if (!mapped) {
      console.log(`  Skip OS ${vos.id_pedido}: cliente ${vos.id_cliente} não encontrado`);
      osSkipped++;
      continue;
    }

    try {
      // Verificar se já existe por vhsys_id
      const existingByVhsys = existingVhsysIds.get(String(vos.id_ordem));
      if (existingByVhsys) {
        // Atualizar OS existente
        await prisma.serviceOrder.update({
          where: { id: existingByVhsys },
          data: {
            status_id: mapped.status_id,
            reported_issue: mapped.reported_issue,
            diagnosis: mapped.diagnosis,
            internal_notes: mapped.internal_notes,
            total_cost: mapped.total_cost,
            total_parts: mapped.total_parts,
            total_services: mapped.total_services,
            estimated_cost: mapped.estimated_cost,
            custom_data: mapped.custom_data,
          },
        });
        osUpdated++;
        continue;
      }

      // Verificar conflito de os_number
      if (existingOSNumbers.has(mapped.os_number)) {
        console.log(`  Skip OS ${vos.id_pedido}: número já existe no ERP`);
        osSkipped++;
        continue;
      }

      // Criar nova OS
      const created = await prisma.serviceOrder.create({ data: mapped });

      // Criar histórico inicial
      await prisma.serviceOrderHistory.create({
        data: {
          company_id: COMPANY_ID,
          service_order_id: created.id,
          from_status_id: null,
          to_status_id: mapped.status_id,
          changed_by: 'MIGRACAO_VHSYS',
          notes: `Migrado do VHSys (OS #${vos.id_pedido}, status: ${vos.status_pedido})`,
          created_at: mapped.created_at,
        },
      });

      // Atualizar contadores do cliente
      await prisma.customer.update({
        where: { id: mapped.customer_id },
        data: {
          total_os: { increment: 1 },
          last_os_at: mapped.created_at,
        },
      });

      existingOSNumbers.add(mapped.os_number);
      osCreated++;

      if (osCreated % 50 === 0) {
        console.log(`  Progresso: ${osCreated} OS criadas...`);
      }
    } catch (e) {
      console.error(`  Erro OS ${vos.id_pedido}: ${e.message}`);
      osError++;
    }
  }

  console.log(`\n  Criadas: ${osCreated}`);
  console.log(`  Atualizadas: ${osUpdated}`);
  console.log(`  Ignoradas: ${osSkipped}`);
  console.log(`  Erros: ${osError}`);

  // 5. Atualizar sequence do os_number
  console.log('\n--- Etapa 4: Ajustar sequence ---');
  const maxOS = await prisma.serviceOrder.aggregate({
    where: { company_id: COMPANY_ID },
    _max: { os_number: true },
  });
  console.log(`  Maior os_number: ${maxOS._max.os_number}`);

  // 6. Resumo final
  const totalOS = await prisma.serviceOrder.count({ where: { company_id: COMPANY_ID } });
  const totalCustomers = await prisma.customer.count({ where: { company_id: COMPANY_ID } });
  console.log(`\n=== Migração Concluída ===`);
  console.log(`Total de clientes no ERP: ${totalCustomers}`);
  console.log(`Total de OS no ERP: ${totalOS}`);
  console.log(`Próxima OS será: #${(maxOS._max.os_number || 0) + 1}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('ERRO FATAL:', e);
  process.exit(1);
});
