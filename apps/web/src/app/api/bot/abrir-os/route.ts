import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'
import { rateLimit } from '@/lib/rate-limit'
import { getNextOsNumber } from '@/lib/os-number'
import { redactName, redactDoc } from '@/lib/log-redact'

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
    // Accept aliases from n8n/external systems (Dify Ana/Grazi use portuguese aliases)
    let { nome, documento, telefone, email, cep, endereco, numero, complemento, bairro, cidade, uf, equipamento, marca, modelo, numero_serie, defeito, observacoes, origem } = body
    nome = nome || body.cliente_nome || body.name || body.customer_name
    documento = documento || body.cpf_cnpj || body.cpf || body.cnpj || body.document || body.documento || body.cpfcnpj
    telefone = telefone || body.cliente_telefone || body.phone || body.mobile || body.phone_number || body.celular || body.whatsapp
    email = email || body.cliente_email
    endereco = endereco || body.logradouro || body.rua || body.endereco_logradouro
    numero = numero || body.endereco_numero || body.numero_endereco
    complemento = complemento || body.endereco_complemento
    bairro = bairro || body.endereco_bairro
    cidade = cidade || body.endereco_cidade || body.localidade || body.municipio
    uf = uf || body.estado || body.endereco_uf || body.endereco_estado

    // Sanitize: strip HTML tags to prevent stored XSS
    const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim()
    if (nome) nome = stripHtml(nome)
    if (defeito) defeito = stripHtml(defeito)
    if (equipamento) equipamento = stripHtml(equipamento)
    if (marca) marca = stripHtml(marca)
    if (modelo) modelo = stripHtml(modelo)
    if (observacoes) observacoes = stripHtml(observacoes)
    if (endereco) endereco = stripHtml(endereco)
    if (numero) numero = stripHtml(String(numero))
    if (complemento) complemento = stripHtml(complemento)
    if (bairro) bairro = stripHtml(bairro)
    if (cidade) cidade = stripHtml(cidade)
    if (uf) uf = stripHtml(uf)

    // Normalizar strings vazias para undefined
    if (typeof equipamento === 'string' && !equipamento.trim()) equipamento = undefined
    if (typeof defeito === 'string' && !defeito.trim()) defeito = undefined
    if (typeof nome === 'string' && !nome.trim()) nome = undefined

    if (!defeito && !equipamento) return botError('Campos "equipamento" e "defeito" sao obrigatorios')

    // Formatar no padrão Title Case
    const { formatName, formatDescription } = await import('@/lib/format-text')
    if (nome) nome = formatName(nome.normalize('NFC'))
    if (marca) marca = formatName(marca.normalize('NFC'))
    if (modelo) modelo = formatName(modelo.normalize('NFC'))
    if (defeito) defeito = formatDescription(defeito.normalize('NFC'))
    if (endereco) endereco = formatName(endereco.normalize('NFC'))
    if (bairro) bairro = formatName(bairro.normalize('NFC'))
    if (cidade) cidade = formatName(cidade.normalize('NFC'))

    // UF: sempre 2 letras maiúsculas
    if (uf) uf = String(uf).replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2) || undefined

    // Email: normalize (lowercase + trim)
    if (email) email = String(email).trim().toLowerCase() || undefined

    // Telefone: só dígitos, remove prefixo 55 se for celular BR padrão (DDD+9) para evitar duplo 55 depois.
    // Descarta valores invalidos (<10 digitos) — bots as vezes emitem placeholders como "WHATSAPP" ou "N/I"
    // que depois de strip ficam com 0/poucos digitos. Melhor armazenar NULL do que lixo.
    if (telefone) {
      let phoneDigits = String(telefone).replace(/\D/g, '')
      if (phoneDigits.length === 13 && phoneDigits.startsWith('55')) phoneDigits = phoneDigits.slice(2)
      if (phoneDigits.length === 12 && phoneDigits.startsWith('55')) phoneDigits = phoneDigits.slice(2)
      telefone = phoneDigits.length >= 10 ? phoneDigits : undefined
    }

    // CEP + auto-enrich via ViaCEP se componentes granulares faltarem
    // Dify Ana/Grazi geralmente enviam só o CEP — preenche o resto automaticamente
    // evitando que tudo caia como string única no campo address_street.
    const cepDigits = cep ? String(cep).replace(/\D/g, '') : ''
    if (cepDigits.length === 8 && (!endereco || !bairro || !cidade || !uf)) {
      try {
        const vc = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`, { signal: AbortSignal.timeout(5000) })
        const vcData = await vc.json().catch(() => ({}))
        if (!vcData.erro) {
          if (!endereco && vcData.logradouro) endereco = formatName(String(vcData.logradouro).normalize('NFC'))
          if (!bairro && vcData.bairro) bairro = formatName(String(vcData.bairro).normalize('NFC'))
          if (!cidade && vcData.localidade) cidade = formatName(String(vcData.localidade).normalize('NFC'))
          if (!uf && vcData.uf) uf = String(vcData.uf).toUpperCase().slice(0, 2)
        }
      } catch {
        // ViaCEP indisponível — segue em frente com o que temos
      }
    }

    // Se equipamento é apenas marca+modelo combinados, usar tipo genérico
    if (equipamento && marca && modelo) {
      const equipNorm = (equipamento || '').trim().toLowerCase()
      const marcaNorm = marca.trim().toLowerCase()
      const modeloNorm = modelo.trim().toLowerCase()
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

    // PRIORIDADE 0: customer_id explicito enviado pelo bot/route ja identificou
    // o cliente correto via auto-identify (incluindo logica de "qual customer
    // tem mais OS ativas"). Quando o phone e compartilhado entre PF+PJ do mesmo
    // dono, find-or-create por doc/phone aqui pode escolher errado.
    const explicitCustomerId = body.customer_id as string | undefined
    if (explicitCustomerId) {
      customer = await prisma.customer.findFirst({
        where: { id: explicitCustomerId, company_id: companyId, deleted_at: null },
      })
      if (customer) {
        console.log(`[Bot/abrir-os] Usando customer_id explicito: ${redactName(customer.legal_name)}`)
      } else {
        console.warn(`[Bot/abrir-os] customer_id ${explicitCustomerId} nao encontrado, caindo em find-or-create`)
      }
    }

    if (!customer && docDigits.length >= 11) {
      const byDoc = await prisma.customer.findFirst({
        where: { company_id: companyId, document_number: docDigits, deleted_at: null },
      })

      // Identity resolution: quando documento + telefone ambos fornecidos,
      // VALIDAR que o customer achado pelo doc tambem bate com o telefone.
      // Caso contrario, e situacao onde 2 clientes diferentes (PF+PJ do mesmo
      // dono) compartilham o telefone — Ana pode ter mandado doc errado
      // (ex: CNPJ de outra entidade que nao bate com o phone da conversa).
      // Nesse caso, preferir o customer que TEM o telefone como fonte de verdade.
      if (byDoc && telefone && telefone.length >= 10) {
        const docCustomerPhones = [byDoc.mobile, byDoc.phone].filter(Boolean).map(p => String(p).replace(/\D/g, ''))
        const telDigits = telefone.replace(/\D/g, '').slice(-10)
        const phoneMatchesDoc = docCustomerPhones.some(p => p.endsWith(telDigits))
        if (!phoneMatchesDoc) {
          // Doc aponta pra customer A, mas phone pertence a customer B.
          // Buscar pelo phone — se achar, prefere esse (mais confiavel).
          const byPhone = await prisma.customer.findFirst({
            where: {
              company_id: companyId, deleted_at: null,
              OR: [
                { mobile: { endsWith: telDigits } },
                { phone: { endsWith: telDigits } },
              ],
            },
          })
          if (byPhone) {
            customer = byPhone
            console.log(`[Bot/abrir-os] Doc ${redactDoc(docDigits)} aponta pra "${byDoc.legal_name}" mas phone pertence a "${byPhone.legal_name}" — preferindo o do phone.`)
          } else {
            customer = byDoc
          }
        } else {
          customer = byDoc
        }
      } else {
        customer = byDoc
      }
      // If CPF/CNPJ provided but not found → new customer (do NOT fallback to phone)
    } else if (!customer && telefone && !docDigits) {
      // Only search by phone when NO document was provided (e.g. WhatsApp bot without CPF)
      if (telefone.length >= 10) {
        customer = await prisma.customer.findFirst({
          where: {
            company_id: companyId, deleted_at: null,
            OR: [
              { mobile: telefone },
              { mobile: telefone.startsWith('55') ? telefone.slice(2) : `55${telefone}` },
              { phone: telefone },
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
          mobile: telefone || undefined,
          email: email || undefined,
          address_zip: cepDigits || undefined,
          address_street: endereco || undefined,
          address_number: numero || undefined,
          address_complement: complemento || undefined,
          address_neighborhood: bairro || undefined,
          address_city: cidade || undefined,
          address_state: uf || undefined,
        },
      })
      isNewCustomer = true
    } else {
      // Cliente existente — comportamento por origem:
      //   - site-pontualtech: sobrescreve (dados do formulário são mais recentes/explícitos)
      //   - bots (Ana/Grazi) e demais: preenche apenas campos vazios ("fill blanks"),
      //     nunca sobrescreve dado já cadastrado sem intenção explícita do operador.
      const isSite = origem === 'site-pontualtech'
      const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())
      const shouldSet = (currentValue: unknown) => isSite || blank(currentValue)

      const updates: Record<string, string> = {}
      if (email && shouldSet(customer.email)) updates.email = email
      if (telefone && shouldSet(customer.mobile)) updates.mobile = telefone
      if (cepDigits && shouldSet(customer.address_zip)) updates.address_zip = cepDigits
      if (endereco && shouldSet(customer.address_street)) updates.address_street = endereco
      if (numero && shouldSet(customer.address_number)) updates.address_number = numero
      if (complemento && shouldSet(customer.address_complement)) updates.address_complement = complemento
      if (bairro && shouldSet(customer.address_neighborhood)) updates.address_neighborhood = bairro
      if (cidade && shouldSet(customer.address_city)) updates.address_city = cidade
      if (uf && shouldSet(customer.address_state)) updates.address_state = uf
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
      const { toTitleCase: tc } = await import('@/lib/format-text')
      return botSuccess({
        os_numero: existingOS.os_number,
        os_id: existingOS.id,
        cliente_id: customer.id,
        cliente_nome: tc(customer.legal_name || ''),
        cliente_novo: false,
        status: existingOS.module_statuses?.name ?? 'Desconhecido',
        duplicada: true,
        mensagem: `OS ${existingOS.os_number} ja existe (criada ha menos de 10 min) para ${tc(customer.legal_name || '')}`,
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
      const osNumber = await getNextOsNumber(companyId, tx as any)

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

    console.log(`[Bot abrir-os] OS #${os.os_number} | Cliente: ${redactName(customer.legal_name)} ${isNewCustomer ? '(NOVO)' : ''}`)

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

    const { toTitleCase: tc2 } = await import('@/lib/format-text')
    return botSuccess({
      os_numero: os.os_number,
      os_id: os.id,
      cliente_id: customer.id,
      cliente_nome: tc2(customer.legal_name || ''),
      cliente_novo: isNewCustomer,
      status: initialStatus.name,
      mensagem: `OS ${os.os_number} criada com sucesso para ${tc2(customer.legal_name || '')}`,
    })
  } catch (err: any) {
    console.error('[Bot abrir-os]', err.message)
    return botError('Erro interno', 500)
  }
}
