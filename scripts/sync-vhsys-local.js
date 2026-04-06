#!/usr/bin/env node
/**
 * Sync VHSys → PontualERP (roda LOCAL no Brasil)
 *
 * Uso: node scripts/sync-vhsys-local.js [limit]
 * Exemplo: node scripts/sync-vhsys-local.js 50
 *
 * Requisitos: Node.js 18+ (usa fetch nativo)
 * Este script chama a API VHSys diretamente (precisa IP brasileiro)
 * e grava no banco de produção do PontualERP.
 */

const VHSYS_URL = 'https://api.vhsys.com/v2'
const VHSYS_HEADERS = {
  'access-token': 'ADSVXVNOdAJgVMVRHFafLNUGagYVPQ',
  'secret-access-token': '57ChnH3avbQcNEygyl9JEdv2JhFXQjm',
  'Content-Type': 'application/json',
}
const DB_URL = 'postgresql://supabase_admin:7Xn0JMMiz8oLWbCevXF2Ol7bgTvzMkY5@37.27.42.114:5433/postgres'
const COMPANY_ID = 'pontualtech-001'

// ─── Helpers ───

async function vhsysFetch(path, retries = 15) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${VHSYS_URL}${path}`, {
        headers: { ...VHSYS_HEADERS, 'Cache-Control': 'no-cache', 'User-Agent': 'VHSysSync/1.0' },
      })
      const text = await r.text()
      if (r.ok && text && !text.includes('"error"') && !text.includes('"404"')) {
        const clean = text.replace(/[\x00-\x1f\x7f]/g, ' ')
        return JSON.parse(clean)
      }
      if (i < 3) process.stdout.write(`.`)
      else if (i === 3) process.stdout.write(`[retrying ${path.substring(0,40)}]`)
    } catch (e) {
      if (i < 3) process.stdout.write(`x`)
    }
    await new Promise(ok => setTimeout(ok, 3000))
  }
  console.log(` FAILED: ${path.substring(0,60)}`)
  return null
}

function cents(val) {
  if (!val || val === '0.00' || val === '0') return 0
  const n = parseFloat(String(val).replace(',', '.'))
  return isNaN(n) ? 0 : Math.round(n * 100)
}

function parseDate(s) {
  if (!s || s === '0000-00-00' || s.startsWith('0000')) return null
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return isNaN(d.getTime()) ? null : d
}

// ─── Main ───

async function main() {
  const limit = parseInt(process.argv[2] || '50')
  console.log(`\n=== VHSys Sync → PontualERP ===`)
  console.log(`Limite: ${limit} OS\n`)

  // 1. Load Prisma
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } })

  // 2. Load status map
  const statuses = await prisma.moduleStatus.findMany({
    where: { company_id: COMPANY_ID, module: 'os' },
  })
  const nameMap = {}
  let defaultStatusId = ''
  for (const s of statuses) {
    nameMap[s.name.toLowerCase()] = s.id
    if (s.is_default) defaultStatusId = s.id
  }
  if (!defaultStatusId && statuses.length) defaultStatusId = statuses[0].id

  const statusMap = {
    'Em Aberto': nameMap['orçar'] || nameMap['orcar'] || nameMap['aberta'] || defaultStatusId,
    'Em Andamento': nameMap['em execução'] || nameMap['em execucao'] || defaultStatusId,
    'Finalizado': nameMap['entregue'] || nameMap['pronta'] || defaultStatusId,
    'Cancelado': nameMap['cancelada'] || defaultStatusId,
    'Faturado': nameMap['entregue'] || defaultStatusId,
    'Aprovado': nameMap['aprovado'] || nameMap['em execução'] || nameMap['em execucao'] || defaultStatusId,
    'Aguardando Aprovação': nameMap['aguardando aprovação'] || nameMap['aguardando aprovacao'] || defaultStatusId,
  }
  console.log('Status map:', Object.entries(statusMap).map(([k,v]) => `${k}→${v.substring(0,8)}`).join(', '))

  // 3. Download OS from VHSys
  console.log(`\nBaixando ${limit} OS do VHSys...`)
  const allOS = []
  let offset = 0
  while (allOS.length < limit) {
    const batch = Math.min(50, limit - allOS.length)
    const result = await vhsysFetch(`/ordens-servico?lixeira=Nao&limit=${batch}&offset=${offset}&order=data_cad_pedido&sort=Desc`)
    if (!result?.data?.length) {
      console.log(`  Sem mais dados em offset=${offset}`)
      break
    }
    allOS.push(...result.data)
    console.log(`  Batch: ${result.data.length} OS (total: ${allOS.length})`)
    offset += batch
    if (result.data.length < batch) break
    await new Promise(ok => setTimeout(ok, 500))
  }
  console.log(`${allOS.length} OS baixadas`)
  if (!allOS.length) { console.log('Nenhuma OS encontrada!'); await prisma.$disconnect(); return }

  // 4. Download clients
  const clientIds = [...new Set(allOS.map(o => o.id_cliente).filter(id => id > 0))]
  console.log(`\nBaixando ${clientIds.length} clientes...`)
  const clients = {}
  for (let i = 0; i < clientIds.length; i += 10) {
    const batch = clientIds.slice(i, i + 10)
    for (const cid of batch) {
      const result = await vhsysFetch(`/clientes/${cid}`)
      if (result?.data) clients[cid] = result.data
    }
    await new Promise(ok => setTimeout(ok, 300))
  }
  console.log(`${Object.keys(clients).length} clientes baixados`)

  // 5. Download items for OS with value
  const osWithValue = allOS.filter(o => parseFloat(o.valor_total_os || '0') > 0)
  console.log(`\nBaixando itens de ${osWithValue.length} OS com valor...`)
  const allItems = {}
  for (const os of osWithValue) {
    const osId = os.id_ordem
    const result = await vhsysFetch(`/ordens-servico/${osId}`)
    if (result?.data) {
      allItems[osId] = {
        servicos: result.data.servicos || [],
        produtos: result.data.produtos || [],
      }
    }
    await new Promise(ok => setTimeout(ok, 200))
  }
  console.log(`${Object.keys(allItems).length} OS com itens`)

  // 6. Upsert clients
  console.log('\nSincronizando clientes...')
  const customerIdMap = {}
  let cCreated = 0, cUpdated = 0
  for (const [vId, vc] of Object.entries(clients)) {
    const isPJ = vc.tipo_pessoa === 'PJ'
    const data = {
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
    }
    try {
      const existing = await prisma.customer.findFirst({ where: { company_id: COMPANY_ID, vhsys_id: String(vId) } })
      if (existing) {
        await prisma.customer.update({ where: { id: existing.id }, data })
        customerIdMap[vId] = existing.id
        cUpdated++
      } else {
        const created = await prisma.customer.create({ data: { ...data, company_id: COMPANY_ID, vhsys_id: String(vId) } })
        customerIdMap[vId] = created.id
        cCreated++
      }
    } catch (e) { /* skip */ }
  }
  console.log(`Clientes: ${cCreated} novos, ${cUpdated} atualizados`)

  // 7. Upsert OS + Items
  console.log('\nSincronizando OS...')
  const existingOS = await prisma.serviceOrder.findMany({
    where: { company_id: COMPANY_ID },
    select: { os_number: true, vhsys_id: true, id: true },
  })
  const existingNumbers = new Set(existingOS.map(o => o.os_number))
  const existingVhsys = new Map(existingOS.filter(o => o.vhsys_id).map(o => [o.vhsys_id, o.id]))

  let osCreated = 0, osUpdated = 0, osSkipped = 0, itemsCreated = 0

  // Process oldest first
  const sorted = [...allOS].reverse()

  for (const vos of sorted) {
    const customerId = customerIdMap[String(vos.id_cliente)]
    if (!customerId) { osSkipped++; continue }

    const equip = (vos.equipamento_ordem || '').trim()
    const parts = equip.split(/\s+/)
    const totalOS = cents(vos.valor_total_os)
    const totalServ = cents(vos.valor_total_servicos)
    const totalPecas = cents(vos.valor_total_pecas)
    const createdAt = parseDate(vos.data_cad_pedido)
    const deliveryDate = parseDate(vos.data_entrega)

    const osData = {
      status_id: statusMap[vos.status_pedido] || defaultStatusId,
      os_type: vos.tipo_atendimento === 1 ? 'BALCAO' : 'COLETA',
      equipment_type: equip || 'Impressora',
      equipment_brand: parts.length >= 2 ? parts[0] : null,
      equipment_model: parts.length >= 2 ? parts.slice(1).join(' ') : null,
      reference: (vos.referencia_ordem || '').trim() || null,
      reported_issue: (vos.problema_ordem || 'Sem descricao').trim(),
      diagnosis: (vos.laudo_ordem || '').trim() || null,
      reception_notes: (vos.referencia_ordem || '').trim() || null,
      internal_notes: [
        (vos.obs_interno_pedido || '').trim(),
        (vos.obs_pedido || '').trim(),
      ].filter(Boolean).join('\n') || null,
      estimated_cost: totalOS || (totalServ + totalPecas),
      total_parts: totalPecas,
      total_services: totalServ,
      total_cost: totalOS || (totalServ + totalPecas),
      estimated_delivery: deliveryDate,
      actual_delivery: (vos.status_pedido === 'Faturado' || vos.status_pedido === 'Finalizado') ? deliveryDate : null,
    }

    try {
      const existingId = existingVhsys.get(String(vos.id_ordem))

      if (existingId) {
        await prisma.serviceOrder.update({ where: { id: existingId }, data: osData })
        // Add items if missing
        const itemCount = await prisma.serviceOrderItem.count({ where: { service_order_id: existingId } })
        if (itemCount === 0 && allItems[vos.id_ordem]) {
          const vi = allItems[vos.id_ordem]
          for (const s of (vi.servicos || [])) {
            await prisma.serviceOrderItem.create({ data: {
              company_id: COMPANY_ID, service_order_id: existingId, item_type: 'SERVICO',
              description: (s.desc_servico || 'Servico').trim(),
              quantity: parseInt(s.horas_servico || '1') || 1,
              unit_price: cents(s.valor_unit_servico), total_price: cents(s.valor_total_servico),
            }})
            itemsCreated++
          }
          for (const p of (vi.produtos || [])) {
            await prisma.serviceOrderItem.create({ data: {
              company_id: COMPANY_ID, service_order_id: existingId, item_type: 'PECA',
              description: (p.desc_produto || 'Peca').trim(),
              quantity: parseInt(p.quantidade || '1') || 1,
              unit_price: cents(p.valor_unit_produto), total_price: cents(p.valor_total_produto),
            }})
            itemsCreated++
          }
        }
        osUpdated++
        continue
      }

      if (existingNumbers.has(vos.id_pedido)) { osSkipped++; continue }

      const created = await prisma.serviceOrder.create({
        data: {
          ...osData, company_id: COMPANY_ID, vhsys_id: String(vos.id_ordem),
          os_number: vos.id_pedido, customer_id: customerId, priority: 'MEDIUM',
          created_at: createdAt || new Date(),
          updated_at: parseDate(vos.data_mod_pedido) || createdAt || new Date(),
        },
      })

      // Items
      const vi = allItems[vos.id_ordem]
      if (vi) {
        for (const s of (vi.servicos || [])) {
          await prisma.serviceOrderItem.create({ data: {
            company_id: COMPANY_ID, service_order_id: created.id, item_type: 'SERVICO',
            description: (s.desc_servico || 'Servico').trim(),
            quantity: parseInt(s.horas_servico || '1') || 1,
            unit_price: cents(s.valor_unit_servico), total_price: cents(s.valor_total_servico),
          }})
          itemsCreated++
        }
        for (const p of (vi.produtos || [])) {
          await prisma.serviceOrderItem.create({ data: {
            company_id: COMPANY_ID, service_order_id: created.id, item_type: 'PECA',
            description: (p.desc_produto || 'Peca').trim(),
            quantity: parseInt(p.quantidade || '1') || 1,
            unit_price: cents(p.valor_unit_produto), total_price: cents(p.valor_total_produto),
          }})
          itemsCreated++
        }
      }

      // History
      await prisma.serviceOrderHistory.create({ data: {
        company_id: COMPANY_ID, service_order_id: created.id,
        to_status_id: osData.status_id, changed_by: 'SYNC_VHSYS',
        notes: `Sincronizado do VHSys (OS #${vos.id_pedido})`,
        created_at: createdAt || new Date(),
      }})

      existingNumbers.add(vos.id_pedido)
      osCreated++
      if (osCreated % 10 === 0) process.stdout.write(`  ${osCreated} criadas...\r`)
    } catch (e) {
      osSkipped++
    }
  }

  // Summary
  const totalOS = await prisma.serviceOrder.count({ where: { company_id: COMPANY_ID } })
  const totalCustomers = await prisma.customer.count({ where: { company_id: COMPANY_ID } })

  console.log(`\n=== RESULTADO ===`)
  console.log(`OS baixadas:    ${allOS.length}`)
  console.log(`OS criadas:     ${osCreated}`)
  console.log(`OS atualizadas: ${osUpdated}`)
  console.log(`OS ignoradas:   ${osSkipped}`)
  console.log(`Itens criados:  ${itemsCreated}`)
  console.log(`Clientes novos: ${cCreated}`)
  console.log(`Clientes atualizados: ${cUpdated}`)
  console.log(`─────────────────────────`)
  console.log(`Total OS no ERP:     ${totalOS}`)
  console.log(`Total Clientes:      ${totalCustomers}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
