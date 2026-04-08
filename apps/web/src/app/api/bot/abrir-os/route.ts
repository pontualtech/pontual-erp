import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'

/**
 * POST /api/bot/abrir-os
 * Cria nova OS com find-or-create de cliente.
 * Inclui proteção contra duplicatas (idempotency 10min).
 * Auth: X-Bot-Key header ou ?key= query param
 */
export async function POST(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const { nome, documento, telefone, email, cep, endereco, equipamento, marca, modelo, defeito, observacoes, origem } = body

    if (!defeito && !equipamento) return botError('Campos "equipamento" e "defeito" sao obrigatorios')

    const companyId = auth.companyId
    const docDigits = (documento || '').replace(/\D/g, '')

    // 1. Find or create customer
    let customer: any = null
    let isNewCustomer = false

    if (docDigits.length >= 11) {
      customer = await prisma.customer.findFirst({
        where: { company_id: companyId, document_number: docDigits, deleted_at: null },
      })
    }

    if (!customer && telefone) {
      const phoneDigits = telefone.replace(/\D/g, '')
      customer = await prisma.customer.findFirst({
        where: {
          company_id: companyId, deleted_at: null,
          OR: [
            { mobile: { contains: phoneDigits.slice(-10) } },
            { phone: { contains: phoneDigits.slice(-10) } },
          ],
        },
      })
    }

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

    // 2. Idempotency: check for duplicate OS in last 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
    const existingOS = await prisma.serviceOrder.findFirst({
      where: {
        company_id: companyId,
        customer_id: customer.id,
        equipment_type: equipamento || 'Impressora',
        reported_issue: defeito || 'Sem descricao',
        created_at: { gte: tenMinAgo },
        deleted_at: null,
      },
      include: { module_statuses: { select: { name: true } } },
    })

    if (existingOS) {
      return botSuccess({
        os_numero: existingOS.os_number,
        os_id: existingOS.id,
        cliente_id: customer.id,
        cliente_nome: customer.legal_name,
        cliente_novo: false,
        status: existingOS.module_statuses?.name ?? 'Desconhecido',
        duplicada: true,
        mensagem: `OS ${existingOS.os_number} ja existe (criada ha menos de 10 min) para ${customer.legal_name}`,
      })
    }

    // 3. Find initial status (Coletar or default)
    const initialStatus = await prisma.moduleStatus.findFirst({
      where: { company_id: companyId, module: 'os', name: { contains: 'oletar', mode: 'insensitive' } },
    }) || await prisma.moduleStatus.findFirst({
      where: { company_id: companyId, module: 'os', is_default: true },
    }) || await prisma.moduleStatus.findFirst({
      where: { company_id: companyId, module: 'os' },
      orderBy: { order: 'asc' },
    })

    if (!initialStatus) return botError('Status de OS nao configurado', 500)

    // 4. Create OS with atomic number
    const os = await prisma.$transaction(async (tx) => {
      const lockKey = Buffer.from(companyId).reduce((acc, b) => acc + b, 0)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      const result = await tx.$queryRaw<{ n: number }[]>`
        SELECT COALESCE(MAX(os_number), 0) + 1 as n FROM service_orders WHERE company_id = ${companyId}
      `
      const osNumber = result[0]?.n || 1

      const created = await tx.serviceOrder.create({
        data: {
          company_id: companyId,
          os_number: osNumber,
          customer_id: customer.id,
          status_id: initialStatus.id,
          priority: 'MEDIUM',
          os_type: 'AVULSO',
          os_location: 'EXTERNO',
          equipment_type: equipamento || 'Impressora',
          equipment_brand: marca || undefined,
          equipment_model: modelo || undefined,
          reported_issue: defeito || 'Sem descricao',
          reception_notes: observacoes || undefined,
          internal_notes: `[BOT ANA] OS aberta em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Cliente: ${customer.legal_name}. Tel: ${telefone || 'N/I'}.`,
        },
      })

      await tx.serviceOrderHistory.create({
        data: {
          company_id: companyId,
          service_order_id: created.id,
          to_status_id: initialStatus.id,
          changed_by: 'BOT_ANA',
          notes: `OS aberta via Bot Ana — ${equipamento || 'Impressora'} ${marca || ''} ${modelo || ''} — ${defeito || ''}`.trim(),
        },
      })

      return created
    })

    console.log(`[Bot abrir-os] OS #${os.os_number} | Cliente: ${customer.legal_name} ${isNewCustomer ? '(NOVO)' : ''}`)

    // Fire-and-forget: enviar email de abertura ao cliente
    if (customer.email) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
      fetch(`${baseUrl}/api/os/${os.id}/notificar-abertura`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: auth.companyId }),
      }).catch(e => console.log('[Bot] Email abertura falhou (ignorado):', e.message))
    }

    return botSuccess({
      os_numero: os.os_number,
      os_id: os.id,
      cliente_id: customer.id,
      cliente_nome: customer.legal_name,
      cliente_novo: isNewCustomer,
      status: initialStatus.name,
      mensagem: `OS ${os.os_number} criada com sucesso para ${customer.legal_name}`,
    })
  } catch (err: any) {
    console.error('[Bot abrir-os]', err.message)
    return botError('Erro interno: ' + (err.message || ''), 500)
  }
}
