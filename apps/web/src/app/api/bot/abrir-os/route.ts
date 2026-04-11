import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'
import { rateLimit } from '@/lib/rate-limit'

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

    // Rate limit: max 30 OS creations per hour (prevents abuse/spam)
    const rl = rateLimit(`abrir-os:${auth.companyId}`, 30, 60 * 60 * 1000)
    if (!rl.allowed) return botError('Limite de criacao de OS atingido. Tente novamente em breve.', 429)

    const body = await req.json()
    // Accept aliases from n8n/external systems
    let { nome, documento, telefone, email, cep, endereco, equipamento, marca, modelo, numero_serie, defeito, observacoes, origem } = body
    nome = nome || body.cliente_nome || body.name || body.customer_name
    documento = documento || body.cpf_cnpj || body.cpf || body.cnpj || body.document
    telefone = telefone || body.cliente_telefone || body.phone || body.mobile
    email = email || body.cliente_email

    // Sanitize: strip HTML tags to prevent stored XSS
    const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim()
    if (nome) nome = stripHtml(nome)
    if (defeito) defeito = stripHtml(defeito)
    if (equipamento) equipamento = stripHtml(equipamento)
    if (marca) marca = stripHtml(marca)
    if (modelo) modelo = stripHtml(modelo)
    if (observacoes) observacoes = stripHtml(observacoes)
    if (endereco) endereco = stripHtml(endereco)

    // Normalizar strings vazias para undefined
    if (typeof equipamento === 'string' && !equipamento.trim()) equipamento = undefined
    if (typeof defeito === 'string' && !defeito.trim()) defeito = undefined
    if (typeof nome === 'string' && !nome.trim()) nome = undefined

    if (!defeito && !equipamento) return botError('Campos "equipamento" e "defeito" sao obrigatorios')

    // Formatar no padrão do ERP — NÃO fazer toUpperCase no defeito (preserva acentos no Alpine/Docker)
    if (nome) nome = nome.trim().normalize('NFC').toUpperCase()
    if (marca) marca = marca.trim().normalize('NFC').toUpperCase()
    if (modelo) modelo = modelo.trim().normalize('NFC').toUpperCase()
    if (defeito) defeito = defeito.trim().normalize('NFC')

    // Se equipamento é apenas marca+modelo combinados, usar tipo genérico
    if (equipamento && marca && modelo) {
      const equipNorm = (equipamento || '').trim().toUpperCase()
      const marcaNorm = marca.trim().toUpperCase()
      const modeloNorm = modelo.trim().toUpperCase()
      const combo = `${marcaNorm} ${modeloNorm}`
      if (equipNorm === combo || equipNorm === `${modeloNorm} ${marcaNorm}` || equipNorm === marcaNorm || equipNorm === modeloNorm) {
        equipamento = null
      }
    }

    const companyId = auth.companyId
    const docDigits = (documento || '').replace(/\D/g, '')

    // 1. Find or create customer
    // IMPORTANT: only search by document (exact match). Phone fallback ONLY when no document provided.
    // This prevents linking OS to wrong customer when CPF doesn't exist but phone partially matches.
    let customer: any = null
    let isNewCustomer = false

    if (docDigits.length >= 11) {
      customer = await prisma.customer.findFirst({
        where: { company_id: companyId, document_number: docDigits, deleted_at: null },
      })
      // If CPF/CNPJ provided but not found → new customer (do NOT fallback to phone)
    } else if (telefone && !docDigits) {
      // Only search by phone when NO document was provided (e.g. WhatsApp bot without CPF)
      const phoneDigits = telefone.replace(/\D/g, '')
      if (phoneDigits.length >= 10) {
        customer = await prisma.customer.findFirst({
          where: {
            company_id: companyId, deleted_at: null,
            OR: [
              { mobile: phoneDigits },
              { mobile: phoneDigits.startsWith('55') ? phoneDigits.slice(2) : `55${phoneDigits}` },
              { phone: phoneDigits },
            ],
          },
        })
      }
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
    } else if (origem === 'site-pontualtech') {
      // Update existing customer with data from site form (site data is more recent/explicit)
      const updates: Record<string, string> = {}
      if (email) updates.email = email
      if (telefone) updates.mobile = telefone.replace(/\D/g, '')
      if (cep) updates.address_zip = cep.replace(/\D/g, '')
      if (endereco) updates.address_street = endereco
      if (Object.keys(updates).length > 0) {
        customer = await prisma.customer.update({ where: { id: customer.id }, data: updates })
      }
    }

    // 2. Idempotency: check for duplicate OS in last 10 minutes (same customer + same equipment)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
    const dedupWhere: any = {
      company_id: companyId,
      customer_id: customer.id,
      created_at: { gte: tenMinAgo },
      deleted_at: null,
    }
    // Only match same equipment type+brand to allow multiple devices from same customer
    if (equipamento) dedupWhere.equipment_type = equipamento
    if (marca) dedupWhere.equipment_brand = marca
    const existingOS = await prisma.serviceOrder.findFirst({
      where: dedupWhere,
      include: { module_statuses: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
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
          serial_number: numero_serie || undefined,
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

    // Fire-and-forget: enviar email + WhatsApp de abertura ao cliente
    if (customer.email || customer.mobile || customer.phone) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
      const internalKey = process.env.INTERNAL_API_KEY || process.env.BOT_ANA_API_KEY || ''
      fetch(`${baseUrl}/api/os/${os.id}/notificar-abertura`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
        body: JSON.stringify({ companyId: auth.companyId }),
      }).catch(e => console.log('[Bot] Notificacao abertura falhou (ignorado):', e.message))
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
    return botError('Erro interno', 500)
  }
}
