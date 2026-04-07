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

/** Look up customer by phone across all companies (used for multi-tenant) */
export async function findCustomerByPhone(phone: string): Promise<{
  customer: any
  companyId: string
} | null> {
  // Normalize phone: remove non-digits, handle +55
  const digits = phone.replace(/\D/g, '')
  // Search with both mobile and phone fields
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

  // Start new flow
  setState(conversationId, {
    action: 'NOVO_ORCAMENTO',
    step: 'AWAITING_EQUIPMENT_TYPE',
    data: {
      customerId,
      companyId,
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
        // Create OS in PontualERP silently (in addition to VHSys)
        try {
          const equipType = state.data.equipment_type || 'Impressora'
          const issue = state.data.issue || 'Sem descricao'
          const initialStatus = await prisma.moduleStatus.findFirst({
            where: { company_id: companyId, module: 'os', is_default: true },
          }) || await prisma.moduleStatus.findFirst({
            where: { company_id: companyId, module: 'os' },
            orderBy: { order: 'asc' },
          })
          if (initialStatus) {
            const result = await prisma.$queryRaw<{ n: number }[]>`
              SELECT COALESCE(MAX(os_number), 0) + 1 as n FROM service_orders WHERE company_id = ${companyId}
            `
            const osNumber = result[0]?.n || 1
            await prisma.serviceOrder.create({
              data: {
                company_id: companyId, os_number: osNumber,
                customer_id: customerId || undefined, status_id: initialStatus.id,
                priority: 'MEDIUM', os_type: 'WHATSAPP', os_location: 'EXTERNO',
                equipment_type: equipType, reported_issue: issue,
              },
            })
            console.log(`[Bot] OS #${osNumber} criada no PontualERP (WhatsApp)`)
          }
        } catch (err) {
          console.error('[Bot] Erro ao criar OS no PontualERP:', err)
        }

        clearState(conversationId)
        const msg = 'Orcamento registrado! Voce pode trazer o equipamento em nossa loja de segunda a sexta, das 9h as 18h.\n\nEndereco: consulte nosso site ou pergunte aqui.\n\nQualquer duvida, estamos a disposicao!'
        await sendChatwootMessage(conversationId, msg)
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
- Telefone: (11) 3136-0415
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
