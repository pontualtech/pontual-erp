import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/webhook/nova-os
 *
 * Webhook para criar OS no PontualERP em paralelo com VHSys.
 * Chamado pelo n8n após a Ana (Dify) coletar os dados e o cliente confirmar.
 *
 * Auth: Bearer token ou query param ?secret=...
 *
 * Body: {
 *   nome: string           — Nome do cliente
 *   documento: string      — CPF ou CNPJ
 *   telefone: string       — Telefone do cliente
 *   email?: string         — Email do cliente
 *   cep?: string           — CEP
 *   endereco?: string      — Endereço completo
 *   equipamento: string    — Tipo (ex: "Impressora")
 *   marca?: string         — Marca (ex: "Epson")
 *   modelo?: string        — Modelo (ex: "L3250")
 *   defeito: string        — Defeito relatado
 *   observacoes?: string   — Observações adicionais
 *   vhsys_os_id?: string   — ID da OS no VHSys (para referência)
 *   vhsys_os_number?: number — Número da OS no VHSys
 *   origem?: string        — Origem (WHATSAPP, TELEFONE, etc)
 * }
 *
 * Response: { success: true, os_number: 54005, os_id: "uuid", customer_id: "uuid", is_new_customer: true }
 */
export async function POST(req: NextRequest) {
  try {
    // Auth: secret token
    const secret = req.nextUrl.searchParams.get('secret')
      || req.headers.get('authorization')?.replace('Bearer ', '')
    const expectedSecret = process.env.BOLETO_WEBHOOK_SECRET || process.env.CHATWOOT_WEBHOOK_SECRET
    if (!secret || secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { nome, documento, telefone, email, cep, endereco, equipamento, marca, modelo, defeito, observacoes, vhsys_os_id, vhsys_os_number, origem } = body

    if (!defeito && !equipamento) {
      return NextResponse.json({ error: 'equipamento e defeito sao obrigatorios' }, { status: 400 })
    }

    const companyId = 'pontualtech-001'

    // 1. Find or create customer
    let customer: any = null
    let isNewCustomer = false
    const docDigits = (documento || '').replace(/\D/g, '')

    // Search by document first
    if (docDigits.length >= 11) {
      customer = await prisma.customer.findFirst({
        where: { company_id: companyId, document_number: docDigits, deleted_at: null },
      })
    }

    // Search by phone
    if (!customer && telefone) {
      const phoneDigits = telefone.replace(/\D/g, '')
      customer = await prisma.customer.findFirst({
        where: {
          company_id: companyId, deleted_at: null,
          OR: [
            { mobile: { contains: phoneDigits.slice(-10) } },
            { phone: { contains: phoneDigits.slice(-10) } },
            { mobile: { contains: phoneDigits.slice(-11) } },
            { phone: { contains: phoneDigits.slice(-11) } },
          ],
        },
      })
    }

    // Create if not found
    if (!customer) {
      const isPJ = docDigits.length === 14
      customer = await prisma.customer.create({
        data: {
          company_id: companyId,
          legal_name: nome || 'Cliente WhatsApp',
          person_type: isPJ ? 'JURIDICA' : 'FISICA',
          customer_type: 'CLIENTE',
          document_number: docDigits || undefined,
          mobile: telefone?.replace(/\D/g, '') || undefined,
          email: email || undefined,
          address_zip: cep?.replace(/\D/g, '') || undefined,
          address_street: endereco || undefined,
        },
      })
      isNewCustomer = true
    }

    // 2. Find "Coletar" status
    const coletarStatus = await prisma.moduleStatus.findFirst({
      where: { company_id: companyId, module: 'os', name: { contains: 'oletar', mode: 'insensitive' } },
    }) || await prisma.moduleStatus.findFirst({
      where: { company_id: companyId, module: 'os', is_default: true },
    }) || await prisma.moduleStatus.findFirst({
      where: { company_id: companyId, module: 'os' },
      orderBy: { order: 'asc' },
    })

    if (!coletarStatus) {
      return NextResponse.json({ error: 'Status de OS nao configurado' }, { status: 500 })
    }

    // 3. Create OS with atomic number
    const result = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COALESCE(MAX(os_number), 0) + 1 as n FROM service_orders WHERE company_id = ${companyId}
    `
    const osNumber = result[0]?.n || 1

    const os = await prisma.serviceOrder.create({
      data: {
        company_id: companyId,
        os_number: osNumber,
        customer_id: customer.id,
        status_id: coletarStatus.id,
        priority: 'MEDIUM',
        os_type: 'AVULSO',
        os_location: 'EXTERNO',
        equipment_type: equipamento || 'Impressora',
        equipment_brand: marca || undefined,
        equipment_model: modelo || undefined,
        reported_issue: defeito || 'Sem descricao',
        reception_notes: observacoes || undefined,
        vhsys_id: vhsys_os_id || undefined,
        internal_notes: `[BOT ANA] OS aberta via WhatsApp/n8n em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Cliente: ${customer.legal_name}. Tel: ${telefone || 'N/I'}. ${vhsys_os_number ? 'VHSys OS #' + vhsys_os_number : ''}`,
      },
    })

    // 4. History
    await prisma.serviceOrderHistory.create({
      data: {
        company_id: companyId,
        service_order_id: os.id,
        to_status_id: coletarStatus.id,
        changed_by: 'BOT_ANA',
        notes: `OS aberta via WhatsApp (Bot Ana/n8n) — ${equipamento} ${marca || ''} ${modelo || ''} — ${defeito}`,
      },
    }).catch(() => {})

    console.log(`[Webhook nova-os] OS #${osNumber} criada | Cliente: ${customer.legal_name} ${isNewCustomer ? '(NOVO)' : ''} | ${equipamento} ${marca || ''} | ${defeito?.substring(0, 50)}`)

    // Fire-and-forget: enviar email de abertura ao cliente
    if (customer.email) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
      fetch(`${baseUrl}/api/os/${os.id}/notificar-abertura`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      }).catch(e => console.log('[Webhook] Email abertura falhou (ignorado):', e.message))
    }

    return NextResponse.json({
      success: true,
      os_number: osNumber,
      os_id: os.id,
      customer_id: customer.id,
      customer_name: customer.legal_name,
      is_new_customer: isNewCustomer,
      status: coletarStatus.name,
    })
  } catch (err: any) {
    console.error('[Webhook nova-os] Error:', err.message)
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 })
  }
}
