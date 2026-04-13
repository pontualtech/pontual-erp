/**
 * Action handlers — each function implements one intent's business logic
 * using the ERP database (Prisma) and Chatwoot API.
 */

import { prisma } from '@pontual/db'
import { sendChatwootMessage, transferToHuman as chatwootTransfer } from './chatwoot-api'
import {
  getState, setState, clearState,
  type ConversationStep,
} from './conversation-state'
import type { CustomerContext } from './detect-intent'
import { getNextOsNumber } from '@/lib/os-number'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Format cents to BRL string */
function formatBRL(cents: number | null | undefined): string {
  if (!cents) return 'R$ 0,00'
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

/** Format date to DD/MM/YYYY */
function formatDate(d: Date | string | null): string {
  if (!d) return '-'
  const date = new Date(d)
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/** Look up customer by phone across all companies */
export async function findCustomerByPhone(phone: string): Promise<{
  customer: any
  companyId: string
} | null> {
  const digits = phone.replace(/\D/g, '')
  const customer = await prisma.customer.findFirst({
    where: {
      OR: [
        { phone: { contains: digits.slice(-10) } },
        { mobile: { contains: digits.slice(-10) } },
        { phone: { contains: digits.slice(-11) } },
        { mobile: { contains: digits.slice(-11) } },
      ],
      deleted_at: null,
    },
    orderBy: { last_os_at: 'desc' },
  })
  if (!customer) return null
  return { customer, companyId: customer.company_id }
}

/** Look up customer by CPF or CNPJ */
export async function findCustomerByDocument(doc: string): Promise<{
  customer: any
  companyId: string
} | null> {
  const digits = doc.replace(/\D/g, '')
  if (digits.length < 11) return null
  const customer = await prisma.customer.findFirst({
    where: { document_number: digits, deleted_at: null },
    orderBy: { last_os_at: 'desc' },
  })
  if (!customer) return null
  return { customer, companyId: customer.company_id }
}

export function buildCustomerContext(customer: any, lastOs?: any): CustomerContext {
  return {
    id: customer.id,
    name: customer.trade_name || customer.legal_name,
    phone: customer.mobile || customer.phone,
    lastOsNumber: lastOs?.os_number,
    lastOsStatus: lastOs?.status?.name,
    totalOs: customer.total_os || 0,
  }
}

// ---------------------------------------------------------------------------
// CONSULTAR_OS — Look up customer's OS and return status list
// ---------------------------------------------------------------------------

export async function handleConsultaOS(
  conversationId: number,
  companyId: string,
  customerId: string,
  params: Record<string, any>
): Promise<string> {
  const where: any = {
    company_id: companyId,
    customer_id: customerId,
    deleted_at: null,
  }

  // If specific OS number provided, filter by it
  if (params.os_number) {
    where.os_number = params.os_number
  }

  const orders = await prisma.serviceOrder.findMany({
    where,
    include: {
      module_statuses: { select: { name: true, color: true } },
    },
    orderBy: { created_at: 'desc' },
    take: params.os_number ? 1 : 5,
  })

  if (orders.length === 0) {
    const msg = params.os_number
      ? `Nao encontrei a OS #${params.os_number} associada ao seu cadastro. Verifique o numero e tente novamente.`
      : 'Nao encontrei nenhuma ordem de servico aberta no seu cadastro.'
    await sendChatwootMessage(conversationId, msg)
    return msg
  }

  const lines = orders.map((os) => {
    const status = os.module_statuses?.name || 'Sem status'
    const equip = [os.equipment_type, os.equipment_brand, os.equipment_model]
      .filter(Boolean)
      .join(' ')
    const dateStr = formatDate(os.created_at)
    return `- *OS #${os.os_number}* | ${equip}\n  Status: ${status} | Aberta em: ${dateStr}`
  })

  const msg = `Encontrei ${orders.length} OS no seu cadastro:\n\n${lines.join('\n\n')}\n\nDeseja mais detalhes de alguma? Informe o numero.`
  await sendChatwootMessage(conversationId, msg)
  return msg
}

// ---------------------------------------------------------------------------
// NOVO_ORCAMENTO — Start new quote flow
// ---------------------------------------------------------------------------

export async function handleNovoOrcamento(
  conversationId: number,
  companyId: string,
  customerId: string | undefined,
  params: Record<string, any>
): Promise<string> {
  const state = getState(conversationId)

  // Check if we're in a multi-step flow
  if (state && state.action === 'NOVO_ORCAMENTO') {
    return continueOrcamentoFlow(conversationId, companyId, customerId, state, params)
  }

  // Start new flow — save phone and contact name for later customer creation
  setState(conversationId, {
    action: 'NOVO_ORCAMENTO',
    step: 'AWAITING_EQUIPMENT_TYPE',
    data: {
      customerId,
      companyId,
      phone: params.phone || '',
      customerName: params.customerName || '',
      equipment_type: params.equipment_type,
      issue: params.issue,
    },
  })

  if (params.equipment_type && params.issue) {
    // User already provided enough info
    return finishOrcamento(conversationId, companyId, customerId, {
      equipment_type: params.equipment_type,
      issue: params.issue,
    })
  }

  let msg: string
  if (params.equipment_type) {
    setState(conversationId, { step: 'AWAITING_ISSUE_DESCRIPTION' })
    msg = `Certo, ${params.equipment_type}. Qual o problema ou defeito que esta apresentando?`
  } else {
    msg = 'Vamos abrir um orcamento para voce! Qual o tipo de equipamento? (ex: impressora, notebook, termica, multifuncional)'
  }

  await sendChatwootMessage(conversationId, msg)
  return msg
}

async function continueOrcamentoFlow(
  conversationId: number,
  companyId: string,
  customerId: string | undefined,
  state: any,
  params: Record<string, any>
): Promise<string> {
  const message = params._raw_message || ''

  switch (state.step) {
    case 'AWAITING_EQUIPMENT_TYPE': {
      setState(conversationId, {
        step: 'AWAITING_ISSUE_DESCRIPTION',
        data: { equipment_type: message },
      })
      const msg = `${message}, entendido! Agora me conta: qual o problema ou defeito?`
      await sendChatwootMessage(conversationId, msg)
      return msg
    }

    case 'AWAITING_ISSUE_DESCRIPTION': {
      return finishOrcamento(conversationId, companyId, customerId, {
        equipment_type: state.data.equipment_type || 'Nao informado',
        issue: message,
      })
    }

    case 'AWAITING_CONFIRMATION': {
      const confirmed = /sim|ok|confirma|pode|isso|yes|quero|vamos/i.test(message)
      if (confirmed) {
        const equipType = state.data.equipment_type || 'Impressora'
        const issue = state.data.issue || 'Sem descricao'
        let osNumber = 0
        let customerName = ''
        let isNewCustomer = false

        try {
          // 1. Find or create customer — search by CPF/CNPJ first, then phone
          let finalCustomerId = customerId

          // Try CPF/CNPJ collected by Ana
          const docCollected = state.data.cpf || state.data.cnpj || state.data.documento || ''
          if (!finalCustomerId && docCollected) {
            const foundByDoc = await findCustomerByDocument(docCollected)
            if (foundByDoc) {
              finalCustomerId = foundByDoc.customer.id
              customerName = foundByDoc.customer.trade_name || foundByDoc.customer.legal_name || ''
              console.log(`[Bot] Cliente encontrado por CPF/CNPJ: ${customerName}`)
            }
          }

          // Fallback: try phone
          if (!finalCustomerId && state.data.phone) {
            const found = await findCustomerByPhone(state.data.phone)
            if (found) {
              finalCustomerId = found.customer.id
              customerName = found.customer.trade_name || found.customer.legal_name || ''
              console.log(`[Bot] Cliente encontrado por telefone: ${customerName}`)
            }
          }

          if (!finalCustomerId) {
            // Create new customer from data collected by Ana
            const contactName = state.data.customerName || state.data.nome || 'Cliente WhatsApp'
            const contactPhone = state.data.phone || ''
            const contactDoc = state.data.cpf || state.data.cnpj || state.data.documento || ''
            const contactEmail = state.data.email || ''
            const contactCep = state.data.cep || ''
            const contactEndereco = state.data.endereco || ''
            const isPJ = contactDoc.replace(/\D/g, '').length === 14

            const newCustomer = await prisma.customer.create({
              data: {
                company_id: companyId,
                legal_name: contactName,
                person_type: isPJ ? 'JURIDICA' : 'FISICA',
                customer_type: 'CLIENTE',
                document_number: contactDoc.replace(/\D/g, '') || undefined,
                mobile: contactPhone,
                email: contactEmail || undefined,
                address_zip: contactCep.replace(/\D/g, '') || undefined,
                address_street: contactEndereco || undefined,
              },
            })
            finalCustomerId = newCustomer.id
            customerName = contactName
            isNewCustomer = true
            console.log(`[Bot] Novo cliente criado: ${contactName} (${contactPhone}) doc:${contactDoc}`)
          } else if (!customerName) {
            const c = await prisma.customer.findUnique({ where: { id: finalCustomerId }, select: { legal_name: true, trade_name: true } })
            customerName = c?.trade_name || c?.legal_name || ''
          }

          // 2. Find "Coletar" status (always open with this status for WhatsApp OS)
          const initialStatus = await prisma.moduleStatus.findFirst({
            where: { company_id: companyId, module: 'os', name: { contains: 'oletar', mode: 'insensitive' } },
          }) || await prisma.moduleStatus.findFirst({
            where: { company_id: companyId, module: 'os', is_default: true },
          }) || await prisma.moduleStatus.findFirst({
            where: { company_id: companyId, module: 'os' },
            orderBy: { order: 'asc' },
          })

          if (initialStatus && finalCustomerId) {
            // 3. Create OS with atomic number (respects os.next_number setting)
            osNumber = await getNextOsNumber(companyId)

            await prisma.serviceOrder.create({
              data: {
                company_id: companyId,
                os_number: osNumber,
                customer_id: finalCustomerId,
                status_id: initialStatus.id,
                priority: 'MEDIUM',
                os_type: 'WHATSAPP',
                os_location: 'EXTERNO',
                equipment_type: equipType,
                equipment_brand: state.data.marca || undefined,
                equipment_model: state.data.modelo || undefined,
                reported_issue: issue,
                reception_notes: state.data.endereco || undefined,
                internal_notes: `[BOT ANA] OS aberta automaticamente via WhatsApp em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Cliente: ${customerName || state.data.customerName || 'N/I'}. Telefone: ${state.data.phone || 'N/I'}.`,
              },
            })

            // 4. Log in history
            await prisma.serviceOrderHistory.create({
              data: {
                company_id: companyId,
                service_order_id: (await prisma.serviceOrder.findFirst({ where: { company_id: companyId, os_number: osNumber } }))!.id,
                to_status_id: initialStatus.id,
                changed_by: 'BOT_ANA',
                notes: `OS aberta via WhatsApp (Bot Ana) — Equipamento: ${equipType} — Defeito: ${issue}`,
              },
            }).catch(() => {})

            console.log(`[Bot] OS #${osNumber} criada no PontualERP para ${customerName}`)
          }
        } catch (err) {
          console.error('[Bot] Erro ao criar OS no PontualERP:', err)
        }

        clearState(conversationId)

        // 5. Send confirmation with OS number to client
        let msg: string
        if (osNumber > 0) {
          msg = `Pronto! Sua OS *#${osNumber}* foi aberta com sucesso!\n\n`
            + `Equipamento: ${equipType}\n`
            + `Defeito: ${issue}\n\n`
            + `Voce pode trazer o equipamento em nossa loja:\n`
            + `Rua Ouvidor Peleja, 660 - Vila Mariana - Sao Paulo/SP\n`
            + `Seg a Sex, 9h as 18h\n\n`
            + `Acompanhe online: https://portal.pontualtech.com.br/portal/pontualtech\n`
            + `WhatsApp Suporte: (11) 2626-3841`
        } else {
          msg = 'Orcamento registrado! Voce pode trazer o equipamento em nossa loja de segunda a sexta, das 9h as 18h.\n\nRua Ouvidor Peleja, 660 - Vila Mariana - Sao Paulo/SP\nWhatsApp Suporte: (11) 2626-3841'
        }
        await sendChatwootMessage(conversationId, msg)

        // 6. Notify team via private note
        if (osNumber > 0) {
          const noteMsg = `[BOT ANA] Nova OS #${osNumber} criada via WhatsApp\n`
            + `Cliente: ${customerName}${isNewCustomer ? ' (NOVO CADASTRO)' : ''}\n`
            + `Equipamento: ${equipType}\n`
            + `Defeito: ${issue}\n`
            + `Link: https://erp.pontualtech.work/os/${osNumber}`
          await sendChatwootMessage(conversationId, noteMsg, true).catch(() => {})
        }

        return msg
      } else {
        clearState(conversationId)
        const msg = 'Sem problema! Se precisar, e so chamar novamente.'
        await sendChatwootMessage(conversationId, msg)
        return msg
      }
    }

    default: {
      clearState(conversationId)
      return handleNovoOrcamento(conversationId, companyId, customerId, params)
    }
  }
}

async function finishOrcamento(
  conversationId: number,
  companyId: string,
  customerId: string | undefined,
  data: { equipment_type: string; issue: string }
): Promise<string> {
  setState(conversationId, {
    step: 'AWAITING_CONFIRMATION',
    data,
  })

  const msg = `Resumo do orcamento:
- Equipamento: ${data.equipment_type}
- Problema: ${data.issue}
${customerId ? '' : '\n(Voce ainda nao esta cadastrado — o atendente ira completar seu cadastro.)'}

Para prosseguir, basta trazer o equipamento em nossa loja. Deseja confirmar?`

  await sendChatwootMessage(conversationId, msg)
  return msg
}

// ---------------------------------------------------------------------------
// AGENDAR_COLETA — Schedule pickup
// ---------------------------------------------------------------------------

export async function handleAgendarColeta(
  conversationId: number,
  companyId: string,
  customerId: string | undefined,
  params: Record<string, any>
): Promise<string> {
  const state = getState(conversationId)

  if (state && state.action === 'AGENDAR_COLETA') {
    return continueColetaFlow(conversationId, state, params)
  }

  // Start coleta flow
  setState(conversationId, {
    action: 'AGENDAR_COLETA',
    step: 'AWAITING_PICKUP_ADDRESS',
    data: { customerId, companyId, address: params.address },
  })

  if (params.address) {
    setState(conversationId, { step: 'AWAITING_PICKUP_DATE' })
    const msg = `Endereco anotado: ${params.address}\n\nQual a melhor data e periodo? (ex: segunda de manha, amanha a tarde)`
    await sendChatwootMessage(conversationId, msg)
    return msg
  }

  const msg = 'Vamos agendar uma coleta! Qual o endereco completo para buscarmos o equipamento?'
  await sendChatwootMessage(conversationId, msg)
  return msg
}

async function continueColetaFlow(
  conversationId: number,
  state: any,
  params: Record<string, any>
): Promise<string> {
  const message = params._raw_message || ''

  switch (state.step) {
    case 'AWAITING_PICKUP_ADDRESS': {
      setState(conversationId, {
        step: 'AWAITING_PICKUP_DATE',
        data: { address: message },
      })
      const msg = `Endereco anotado!\n\nQual a melhor data e periodo para a coleta? (ex: segunda de manha, quarta a tarde)`
      await sendChatwootMessage(conversationId, msg)
      return msg
    }

    case 'AWAITING_PICKUP_DATE': {
      setState(conversationId, {
        step: 'AWAITING_PICKUP_CONFIRMATION',
        data: { date: message },
      })
      const addr = state.data.address || 'a confirmar'
      const msg = `Coleta agendada:\n- Endereco: ${addr}\n- Data/periodo: ${message}\n\nConfirma? (sim/nao)`
      await sendChatwootMessage(conversationId, msg)
      return msg
    }

    case 'AWAITING_PICKUP_CONFIRMATION': {
      const confirmed = /sim|ok|confirma|pode|isso|yes/i.test(message)
      clearState(conversationId)

      if (confirmed) {
        const msg = 'Coleta confirmada! Nosso motorista ira no endereco e horario combinados. Voce recebera uma confirmacao no dia.\n\nQualquer alteracao, nos avise com antecedencia.'
        await sendChatwootMessage(conversationId, msg)
        return msg
      } else {
        const msg = 'Coleta cancelada. Se quiser reagendar, e so pedir!'
        await sendChatwootMessage(conversationId, msg)
        return msg
      }
    }

    default: {
      clearState(conversationId)
      return handleAgendarColeta(conversationId, state.data.companyId, state.data.customerId, params)
    }
  }
}

// ---------------------------------------------------------------------------
// STATUS_PAGAMENTO — Check payment status
// ---------------------------------------------------------------------------

export async function handleStatusPagamento(
  conversationId: number,
  companyId: string,
  customerId: string
): Promise<string> {
  const receivables = await prisma.accountReceivable.findMany({
    where: {
      company_id: companyId,
      customer_id: customerId,
      status: { in: ['PENDENTE', 'PARCIAL', 'VENCIDO'] },
    },
    include: {
      service_orders: { select: { os_number: true } },
    },
    orderBy: { due_date: 'asc' },
    take: 10,
  })

  if (receivables.length === 0) {
    const msg = 'Nao encontrei nenhum pagamento pendente no seu cadastro. Tudo em dia!'
    await sendChatwootMessage(conversationId, msg)
    return msg
  }

  const lines = receivables.map((r) => {
    const osNum = r.service_orders?.os_number ? ` (OS #${r.service_orders.os_number})` : ''
    const due = formatDate(r.due_date)
    const isOverdue = new Date(r.due_date) < new Date()
    const statusLabel = isOverdue ? 'VENCIDO' : r.status
    return `- ${r.description}${osNum}\n  Valor: ${formatBRL(r.total_amount)} | Venc: ${due} | ${statusLabel}`
  })

  const total = receivables.reduce((sum, r) => sum + (r.total_amount || 0), 0)

  const msg = `Seus pagamentos pendentes:\n\n${lines.join('\n\n')}\n\n*Total pendente: ${formatBRL(total)}*\n\nPrecisa de boleto ou chave PIX? Me avise!`
  await sendChatwootMessage(conversationId, msg)
  return msg
}

// ---------------------------------------------------------------------------
// FALAR_HUMANO — Transfer to human agent
// ---------------------------------------------------------------------------

export async function handleTransferHuman(
  conversationId: number
): Promise<string> {
  clearState(conversationId)

  const msg = 'Entendido! Vou transferir voce para um atendente. Aguarde um momento, por favor.'
  await sendChatwootMessage(conversationId, msg)
  await chatwootTransfer(conversationId)
  return msg
}

// ---------------------------------------------------------------------------
// GENERAL — Use AI for general questions, or send a canned response
// ---------------------------------------------------------------------------

export async function handleGeneralQuestion(
  conversationId: number,
  message: string,
  customerName?: string,
  options?: {
    provider?: string
    apiKey?: string
    customPrompt?: string
  }
): Promise<string> {
  // Try AI response if API key is available
  if (options?.apiKey) {
    try {
      const aiResponse = await generateAIResponse(message, customerName, options)
      await sendChatwootMessage(conversationId, aiResponse)
      return aiResponse
    } catch (err) {
      console.error('[GeneralQuestion] AI response failed:', err)
    }
  }

  // Fallback: canned response
  const greeting = customerName ? `Ola, ${customerName}!` : 'Ola!'
  const msg = `${greeting} Sou o assistente virtual da PontualTech.

Posso ajudar com:
- Consultar status da sua OS
- Abrir orcamento para conserto
- Agendar coleta de equipamento
- Verificar pagamentos

O que voce precisa?`

  await sendChatwootMessage(conversationId, msg)
  return msg
}

async function generateAIResponse(
  message: string,
  customerName?: string,
  options?: { provider?: string; apiKey?: string; customPrompt?: string }
): Promise<string> {
  const systemPrompt = options?.customPrompt || `Voce e o assistente virtual da PontualTech, assistencia tecnica de impressoras e equipamentos em Sao Paulo.
Responda de forma educada, concisa e em portugues brasileiro.
${customerName ? `O cliente se chama ${customerName}.` : ''}
Se nao souber a resposta, sugira que o cliente fale com um atendente.
Nao invente informacoes sobre precos ou prazos.
Informacoes gerais:
- Horario: Seg-Sex 9h-18h
- Telefone/WhatsApp: (11) 2626-3841
- Servicos: conserto de impressoras, notebooks, termicas, multifuncionais
- Aceitamos: coleta e entrega, balcao`

  if (options?.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
      }),
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || 'Desculpe, nao consegui processar sua mensagem.'
  }

  if (options?.provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
    })
    const data = await res.json()
    return data.content?.[0]?.text || 'Desculpe, nao consegui processar sua mensagem.'
  }

  throw new Error('No AI provider available')
}
