/**
 * POST /api/chatwoot/webhook
 *
 * Receives Chatwoot webhook events (message_created, conversation_status_changed, etc.)
 * and routes them through the AI chatbot pipeline:
 *   1. Validate event (message_created + incoming only)
 *   2. Extract phone, message content, conversation ID
 *   3. Identify customer by phone in DB
 *   4. Check for active multi-step flow (conversation state)
 *   5. Detect intent using AI or keywords
 *   6. Execute handler
 *   7. Response is sent back via Chatwoot API (inside handlers)
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import crypto from 'crypto'
import { detectIntent, type AIProvider, type CustomerContext } from '@/lib/ai/detect-intent'
import {
  findCustomerByPhone,
  buildCustomerContext,
  handleConsultaOS,
  handleNovoOrcamento,
  handleAgendarColeta,
  handleStatusPagamento,
  handleTransferHuman,
  handleGeneralQuestion,
} from '@/lib/ai/handlers'
import {
  getState,
  hasActiveState,
} from '@/lib/ai/conversation-state'
import { sendChatwootMessage } from '@/lib/ai/chatwoot-api'

// ---------------------------------------------------------------------------
// Config loader — reads chatbot settings from the settings table
// ---------------------------------------------------------------------------

interface BotConfig {
  enabled: boolean
  provider: AIProvider
  apiKey: string
  customPrompt: string
}

async function loadBotConfig(companyId: string): Promise<BotConfig> {
  const settings = await prisma.setting.findMany({
    where: {
      company_id: companyId,
      key: { startsWith: 'chatbot.' },
    },
  })

  const map = new Map(settings.map(s => [s.key, s.value]))

  let apiKey = map.get('chatbot.api_key') || ''
  if (apiKey && apiKey.includes(':')) {
    // Encrypted with the same method as /api/settings/chatbot
    try {
      const encKey = process.env.ENCRYPTION_KEY || 'pontual-erp-default-encryption-key-32b'
      const key = crypto.scryptSync(encKey, 'salt', 32)
      const [ivHex, encrypted] = apiKey.split(':')
      const iv = Buffer.from(ivHex, 'hex')
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      apiKey = decrypted
    } catch {
      console.error('[Webhook] Failed to decrypt API key')
      apiKey = ''
    }
  }

  return {
    enabled: map.get('chatbot.enabled') !== 'false',
    provider: (map.get('chatbot.provider') as AIProvider) || 'keywords',
    apiKey,
    customPrompt: map.get('chatbot.system_prompt') || '',
  }
}

// ---------------------------------------------------------------------------
// Webhook verification token (optional extra security)
// ---------------------------------------------------------------------------

function validateWebhookToken(req: NextRequest): boolean {
  const secret = process.env.CHATWOOT_WEBHOOK_SECRET
  if (!secret) return true // No secret configured = accept all

  const token = req.headers.get('x-chatwoot-webhook-token')
    || req.nextUrl.searchParams.get('token')
  return token === secret
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    // 0. Validate webhook token
    if (!validateWebhookToken(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const event = body.event

    // 1. Only process incoming messages
    if (event !== 'message_created') {
      return NextResponse.json({ status: 'ignored', reason: 'not message_created' })
    }

    const messageType = body.message_type
    if (messageType !== 'incoming') {
      return NextResponse.json({ status: 'ignored', reason: 'not incoming' })
    }

    // Ignore private messages (internal notes)
    if (body.private) {
      return NextResponse.json({ status: 'ignored', reason: 'private' })
    }

    const content = body.content?.trim()
    if (!content) {
      return NextResponse.json({ status: 'ignored', reason: 'empty' })
    }

    const conversationId: number = body.conversation?.id
    if (!conversationId) {
      return NextResponse.json({ error: 'No conversation ID' }, { status: 400 })
    }

    // 2. Extract sender phone
    const sender = body.sender || body.conversation?.contact_inbox?.contact || {}
    const phone = sender.phone_number || sender.phone || ''

    console.log(`[Webhook] Message from ${phone || 'unknown'} in conversation ${conversationId}: ${content.substring(0, 80)}`)

    // 3. Identify customer by phone
    let customerId: string | undefined
    let companyId: string | undefined
    let customerContext: CustomerContext | undefined

    if (phone) {
      const found = await findCustomerByPhone(phone)
      if (found) {
        customerId = found.customer.id
        companyId = found.companyId

        // Get last OS for context
        const lastOs = await prisma.serviceOrder.findFirst({
          where: { customer_id: customerId, deleted_at: null },
          include: { module_statuses: { select: { name: true } } },
          orderBy: { created_at: 'desc' },
        })

        customerContext = buildCustomerContext(found.customer, lastOs)
      }
    }

    // Fallback company ID — use first company if customer not found
    if (!companyId) {
      const firstCompany = await prisma.company.findFirst({ select: { id: true } })
      companyId = firstCompany?.id || ''
    }

    if (!companyId) {
      console.error('[Webhook] No company found in database')
      return NextResponse.json({ error: 'No company configured' }, { status: 500 })
    }

    // 4. Load bot config
    const config = await loadBotConfig(companyId)

    if (!config.enabled) {
      return NextResponse.json({ status: 'ignored', reason: 'bot_disabled' })
    }

    // 5. Check for active multi-step flow
    if (hasActiveState(conversationId)) {
      const state = getState(conversationId)!
      const params = { _raw_message: content }

      let response: string
      switch (state.action) {
        case 'NOVO_ORCAMENTO':
          response = await handleNovoOrcamento(conversationId, companyId, customerId, params)
          break
        case 'AGENDAR_COLETA':
          response = await handleAgendarColeta(conversationId, companyId, customerId, params)
          break
        default:
          // Unknown active state — clear and re-detect
          response = await processNewMessage(
            conversationId, content, companyId, customerId, customerContext, config, phone
          )
      }

      await logBotResponse(companyId, conversationId, content, state.action, response, {
        customerName: customerContext?.name,
        customerPhone: phone,
        provider: config.provider,
      })
      return NextResponse.json({ status: 'ok', action: state.action })
    }

    // 6. Detect intent and handle
    try {
      const response = await processNewMessage(
        conversationId, content, companyId, customerId, customerContext, config, phone
      )
    } catch (processErr) {
      // Fallback: always respond even if processing fails
      console.error('[Webhook] processNewMessage error:', processErr)
      try {
        await sendChatwootMessage(conversationId, 'Desculpe, estou com dificuldade para processar sua mensagem. Um atendente sera notificado. WhatsApp Suporte: (11) 2626-3841')
      } catch {}
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    console.error('[Webhook] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// Process a new message (no active state)
// ---------------------------------------------------------------------------

async function processNewMessage(
  conversationId: number,
  content: string,
  companyId: string,
  customerId: string | undefined,
  customerContext: CustomerContext | undefined,
  config: BotConfig,
  phone?: string
): Promise<string> {
  // Detect intent
  const intent = await detectIntent(content, {
    provider: config.provider,
    apiKey: config.apiKey,
    customerContext,
    customPrompt: config.customPrompt,
  })

  console.log(`[Webhook] Intent: ${intent.action} (confidence: ${intent.confidence})`)

  // Low confidence? Treat as general
  const action = intent.confidence < 0.4 ? 'GENERAL' : intent.action

  let response: string

  switch (action) {
    case 'CONSULTAR_OS':
      if (!customerId) {
        response = 'Nao consegui identificar seu cadastro pelo telefone. Por favor, informe o numero da OS ou entre em contato com nosso atendimento.'
        await sendChatwootMessage(conversationId, response)
      } else {
        response = await handleConsultaOS(conversationId, companyId, customerId, intent.params)
      }
      break

    case 'NOVO_ORCAMENTO':
      response = await handleNovoOrcamento(conversationId, companyId, customerId, intent.params)
      break

    case 'AGENDAR_COLETA':
      response = await handleAgendarColeta(conversationId, companyId, customerId, intent.params)
      break

    case 'STATUS_PAGAMENTO':
      if (!customerId) {
        response = 'Nao consegui identificar seu cadastro pelo telefone. Por favor, entre em contato com nosso atendimento para consultar pagamentos.'
        await sendChatwootMessage(conversationId, response)
      } else {
        response = await handleStatusPagamento(conversationId, companyId, customerId)
      }
      break

    case 'FALAR_HUMANO':
      response = await handleTransferHuman(conversationId)
      break

    case 'GENERAL':
    default:
      response = await handleGeneralQuestion(
        conversationId,
        content,
        customerContext?.name,
        {
          provider: config.provider,
          apiKey: config.apiKey,
          customPrompt: config.customPrompt,
        }
      )
      break
  }

  // Ensure response was actually sent — if empty, send fallback
  if (!response) {
    response = 'Ola! Como posso ajudar? Posso consultar o status de uma OS, abrir um orcamento ou transferir para um atendente.'
    await sendChatwootMessage(conversationId, response)
  }

  await logBotResponse(companyId, conversationId, content, action, response, {
    customerName: customerContext?.name,
    customerPhone: phone || customerContext?.phone,
    provider: config.provider,
    confidence: intent.confidence,
  }).catch(() => {}) // Don't fail on log error
  return response
}

// ---------------------------------------------------------------------------
// Log bot responses to ChatbotLog table
// ---------------------------------------------------------------------------

async function logBotResponse(
  companyId: string,
  conversationId: number,
  userMessage: string,
  action: string,
  botResponse: string,
  extra?: {
    customerName?: string
    customerPhone?: string
    provider?: string
    model?: string
    confidence?: number
    isTransfer?: boolean
  }
) {
  try {
    const status = extra?.isTransfer ? 'transferred'
      : action === 'FALAR_HUMANO' ? 'transferred'
      : 'bot'

    await prisma.chatbotLog.create({
      data: {
        company_id: companyId,
        customer_name: extra?.customerName || null,
        customer_phone: extra?.customerPhone || null,
        intent: action,
        confidence: extra?.confidence ?? null,
        message_in: userMessage.substring(0, 2000),
        message_out: botResponse.substring(0, 2000),
        provider: extra?.provider || null,
        model: extra?.model || null,
        status,
      },
    })
  } catch (err) {
    console.error('[Webhook] Failed to log response:', err)
  }
}
