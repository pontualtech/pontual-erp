import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

const PROXY_URL = 'https://vhsys-proxy.vercel.app/api/migracao-os'

// ====== Helpers ======

async function fetchJSON(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (r.ok) return await r.json()
    } catch {}
    await new Promise(ok => setTimeout(ok, 2000 * (i + 1)))
  }
  return null
}

function parseDecimalToCents(val: string | null | undefined): number {
  if (!val || val === '0.00' || val === '0') return 0
  const num = parseFloat(String(val).replace(',', '.'))
  return isNaN(num) ? 0 : Math.round(num * 100)
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || dateStr === '0000-00-00' || dateStr === '0000-00-00 00:00:00') return null
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T'))
  return isNaN(d.getTime()) ? null : d
}

// ====== Main sync ======

export async function POST(req: NextRequest) {
  const auth = await requirePermission('config', 'manage')
  if (auth instanceof NextResponse) return auth
  const user = auth

  const body = await req.json().catch(() => ({}))
  const limit = Math.min(body.limit || 500, 500)

  const companyId = user.companyId

  // 1. Load status map from DB
  const statuses = await prisma.moduleStatus.findMany({
    where: { company_id: companyId, module: 'os' },
  })
  const nameMap: Record<string, string> = {}
  let defaultStatusId = ''
  for (const s of statuses) {
    nameMap[s.name.toLowerCase()] = s.id
    if (s.is_default) defaultStatusId = s.id
  }
  if (!defaultStatusId && statuses.length > 0) defaultStatusId = statuses[0].id

  const statusMap: Record<string, string> = {
    'Em Aberto': nameMap['aberta'] || nameMap['orcar'] || defaultStatusId,
    'Em Andamento': nameMap['em execucao'] || defaultStatusId,
    'Finalizado': nameMap['pronta'] || nameMap['entregue'] || defaultStatusId,
    'Cancelado': nameMap['cancelada'] || defaultStatusId,
    'Faturado': nameMap['entregue'] || defaultStatusId,
    'Aprovado': nameMap['aprovado'] || nameMap['em execucao'] || defaultStatusId,
  }

  const log: string[] = []
  const addLog = (msg: string) => { log.push(msg) }

  try {
    // 2. Download OS in batches
    addLog(`Buscando ultimas ${limit} OS do VHSys...`)
    const allOS: any[] = []
    let offset = 0
    while (allOS.length < limit) {
      const batchLimit = Math.min(250, limit - allOS.length)
      const result = await fetchJSON(`${PROXY_URL}?action=os&limit=${batchLimit}&offset=${offset}`)
      if (!result?.data?.length) break
      allOS.push(...result.data)
      offset += 250
      if (result.data.length < 250) break
    }
    addLog(`${allOS.length} OS baixadas (${allOS[allOS.length - 1]?.id_pedido} - ${allOS[0]?.id_pedido})`)

    // 3. Download unique clients
    const clientIds = [...new Set(allOS.map((o: any) => o.id_cliente).filter((id: number) => id > 0))]
    addLog(`${clientIds.length} clientes unicos, buscando detalhes...`)

    const allClients: any[] = []
    for (let i = 0; i < clientIds.length; i += 15) {
      const batch = clientIds.slice(i, i + 15)
      const result = await fetchJSON(`${PROXY_URL}?action=clientes&ids=${batch.join(',')}`)
      if (result?.data) allClients.push(...result.data)
    }
    addLog(`${allClients.length} clientes baixados`)

    // 4. Download items for OS with value
    const osWithValue = allOS.filter((o: any) => parseFloat(o.valor_total_os || '0') > 0)
    addLog(`${osWithValue.length} OS com valor, buscando itens...`)

    const allItems: Record<string, any> = {}
    for (let i = 0; i < osWithValue.length; i += 10) {
      const batch = osWithValue.slice(i, i + 10)
      const ids = batch.map((o: any) => o.id_ordem).join(',')
      const result = await fetchJSON(`${PROXY_URL}?action=os-itens-batch&ids=${ids}`)
      if (result?.data) Object.assign(allItems, result.data)
      await new Promise(ok => setTimeout(ok, 300))
    }
    addLog(`${Object.keys(allItems).length} OS com itens encontrados`)

    // 5. Upsert clients
    const customerIdMap: Record<string, string> = {}
    let cCreated = 0, cUpdated = 0

    for (const vc of allClients) {
      const vhsysId = String(vc.id_cliente)
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
        const existing = await prisma.customer.findFirst({
          where: { company_id: companyId, vhsys_id: vhsysId },
        })
        if (existing) {
          await prisma.customer.update({ where: { id: existing.id }, data })
          customerIdMap[vhsysId] = existing.id
          cUpdated++
        } else {
          const created = await prisma.customer.create({
            data: {
              ...data,
              company_id: companyId,
              vhsys_id: vhsysId,
              custom_data: { vhsys_id_registro: vc.id_registro, vhsys_data_cad: vc.data_cad_cliente },
            },
          })
          customerIdMap[vhsysId] = created.id
          cCreated++
        }
      } catch {}
    }
    addLog(`Clientes: ${cCreated} novos, ${cUpdated} atualizados`)

    // 6. Upsert OS + Items
    const existingOS = await prisma.serviceOrder.findMany({
      where: { company_id: companyId },
      select: { os_number: true, vhsys_id: true, id: true },
    })
    const existingNumbers = new Set(existingOS.map(o => o.os_number))
    const existingVhsys = new Map(existingOS.filter(o => o.vhsys_id).map(o => [o.vhsys_id!, o.id]))

    let osCreated = 0, osUpdated = 0, osSkipped = 0, itemsCreated = 0

    // Process oldest first
    const sorted = [...allOS].reverse()

    for (const vos of sorted) {
      const customerId = customerIdMap[String(vos.id_cliente)]
      if (!customerId) { osSkipped++; continue }

      const equip = (vos.equipamento_ordem || '').trim()
      const parts = equip.split(/\s+/)
      const totalOS = parseDecimalToCents(vos.valor_total_os)
      const totalServ = parseDecimalToCents(vos.valor_total_servicos)
      const totalPecas = parseDecimalToCents(vos.valor_total_pecas)
      const createdAt = parseDate(vos.data_cad_pedido)

      const osData = {
        status_id: statusMap[vos.status_pedido] || defaultStatusId,
        reported_issue: (vos.problema_ordem || 'Sem descricao').trim(),
        diagnosis: (vos.laudo_ordem || '').trim() || null,
        internal_notes: (vos.obs_interno_pedido || '').trim() || null,
        estimated_cost: totalOS || (totalServ + totalPecas),
        approved_cost: (vos.status_pedido === 'Finalizado' || vos.status_pedido === 'Faturado') ? totalOS : 0,
        total_parts: totalPecas,
        total_services: totalServ,
        total_cost: totalOS || (totalServ + totalPecas),
        custom_data: {
          vhsys_id_ordem: vos.id_ordem,
          vhsys_id_pedido: vos.id_pedido,
          vhsys_referencia: vos.referencia_ordem,
          vhsys_obs_pedido: vos.obs_pedido,
          vhsys_nome_tecnico: vos.nome_tecnico,
          migrated_from: 'vhsys',
          migrated_at: new Date().toISOString(),
        } as any,
      }

      try {
        const existingId = existingVhsys.get(String(vos.id_ordem))

        if (existingId) {
          // Update existing OS
          await prisma.serviceOrder.update({ where: { id: existingId }, data: osData })

          // Add items if missing
          const itemCount = await prisma.serviceOrderItem.count({ where: { service_order_id: existingId } })
          if (itemCount === 0 && allItems[String(vos.id_ordem)]) {
            const vItems = allItems[String(vos.id_ordem)]
            for (const s of (vItems.servicos || [])) {
              await prisma.serviceOrderItem.create({ data: {
                company_id: companyId, service_order_id: existingId, item_type: 'SERVICO',
                description: (s.desc_servico || 'Servico').trim(),
                quantity: parseInt(s.horas_servico || '1') || 1,
                unit_price: parseDecimalToCents(s.valor_unit_servico),
                total_price: parseDecimalToCents(s.valor_total_servico),
              }})
              itemsCreated++
            }
            for (const p of (vItems.produtos || [])) {
              await prisma.serviceOrderItem.create({ data: {
                company_id: companyId, service_order_id: existingId, item_type: 'PECA',
                description: (p.desc_produto || 'Peca').trim(),
                quantity: parseInt(p.quantidade || '1') || 1,
                unit_price: parseDecimalToCents(p.valor_unit_produto),
                total_price: parseDecimalToCents(p.valor_total_produto),
              }})
              itemsCreated++
            }
          }
          osUpdated++
          continue
        }

        // Skip if number conflict
        if (existingNumbers.has(vos.id_pedido)) { osSkipped++; continue }

        // Create new OS
        const created = await prisma.serviceOrder.create({
          data: {
            ...osData,
            company_id: companyId,
            vhsys_id: String(vos.id_ordem),
            os_number: vos.id_pedido,
            customer_id: customerId,
            priority: 'MEDIUM',
            os_type: vos.tipo_atendimento === 1 ? 'BALCAO' : 'COLETA',
            equipment_type: equip || 'Impressora',
            equipment_brand: parts.length >= 2 ? parts[0] : null,
            equipment_model: parts.length >= 2 ? parts.slice(1).join(' ') : null,
            estimated_delivery: parseDate(vos.data_entrega),
            actual_delivery: vos.status_pedido === 'Faturado' ? (parseDate(vos.data_entrega) || parseDate(vos.data_realizacao)) : null,
            created_at: createdAt || new Date(),
            updated_at: parseDate(vos.data_mod_pedido) || createdAt || new Date(),
          },
        })

        // Items
        const vItems = allItems[String(vos.id_ordem)]
        if (vItems) {
          for (const s of (vItems.servicos || [])) {
            await prisma.serviceOrderItem.create({ data: {
              company_id: companyId, service_order_id: created.id, item_type: 'SERVICO',
              description: (s.desc_servico || 'Servico').trim(),
              quantity: parseInt(s.horas_servico || '1') || 1,
              unit_price: parseDecimalToCents(s.valor_unit_servico),
              total_price: parseDecimalToCents(s.valor_total_servico),
            }})
            itemsCreated++
          }
          for (const p of (vItems.produtos || [])) {
            await prisma.serviceOrderItem.create({ data: {
              company_id: companyId, service_order_id: created.id, item_type: 'PECA',
              description: (p.desc_produto || 'Peca').trim(),
              quantity: parseInt(p.quantidade || '1') || 1,
              unit_price: parseDecimalToCents(p.valor_unit_produto),
              total_price: parseDecimalToCents(p.valor_total_produto),
            }})
            itemsCreated++
          }
        }

        // History
        await prisma.serviceOrderHistory.create({ data: {
          company_id: companyId, service_order_id: created.id,
          to_status_id: osData.status_id, changed_by: 'SYNC_VHSYS',
          notes: `Sincronizado do VHSys (OS #${vos.id_pedido})`,
          created_at: createdAt || new Date(),
        }})

        existingNumbers.add(vos.id_pedido)
        existingVhsys.set(String(vos.id_ordem), created.id)
        osCreated++
      } catch (e: any) {
        osSkipped++
      }
    }

    addLog(`OS: ${osCreated} novas, ${osUpdated} atualizadas, ${osSkipped} ignoradas`)
    addLog(`Itens de servico: ${itemsCreated} criados`)

    // Final counts
    const totalOS = await prisma.serviceOrder.count({ where: { company_id: companyId } })
    const totalCustomers = await prisma.customer.count({ where: { company_id: companyId } })
    const maxOS = await prisma.serviceOrder.aggregate({ where: { company_id: companyId }, _max: { os_number: true } })

    return NextResponse.json({
      success: true,
      summary: {
        os_downloaded: allOS.length,
        os_created: osCreated,
        os_updated: osUpdated,
        os_skipped: osSkipped,
        clients_created: cCreated,
        clients_updated: cUpdated,
        items_created: itemsCreated,
        total_os: totalOS,
        total_customers: totalCustomers,
        next_os_number: (maxOS._max.os_number || 0) + 1,
      },
      log,
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, log }, { status: 500 })
  }
}
