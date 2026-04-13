/**
 * POST /api/chatwoot/bot
 *
 * Chatwoot webhook handler that routes messages through Dify AI.
 * Replaces the n8n Bot Ana workflow entirely.
 *
 * Flow: Chatwoot webhook -> this route -> Dify API -> Chatwoot API response
 *
 * Design:
 *   - Responds 200 immediately, processes async (Chatwoot timeout = 5s)
 *   - All state in PostgreSQL (bot_conversations table)
 *   - Dify conversation_id persisted for memory continuity
 *   - Debounce: consolidates messages from last 5s
 *   - Idempotent: checks message_id to avoid reprocessing
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Multi-tenant bot config: each company has its own Dify, Chatwoot, etc.
// Selected by ?company= query param in webhook URL.
interface BotCompanyConfig {
  companyId: string
  slug: string
  allowedInboxes: number[]
  difyBaseUrl: string
  difyApiKey: string
  botApiKey: string
  cwUrl: string
  cwAccountId: string
  cwToken: string
  portalUrl: string
  supportWhatsApp: string
  botOrigin: string
  botAgentId: number // Chatwoot agent ID used by the bot (skip human_takeover for this ID)
}

const COMPANY_CONFIGS: Record<string, BotCompanyConfig> = {
  pontualtech: {
    companyId: process.env.BOT_ANA_COMPANY_ID || 'pontualtech-001',
    slug: 'pontualtech',
    allowedInboxes: [2, 4, 9],
    difyBaseUrl: process.env.DIFY_BASE_URL || 'https://dify.pontualtech.work',
    difyApiKey: process.env.DIFY_API_KEY || '',
    botApiKey: process.env.BOT_ANA_API_KEY || '',
    cwUrl: process.env.CHATWOOT_URL || 'https://chat.pontualtech.work',
    cwAccountId: process.env.CHATWOOT_ACCOUNT_ID || '1',
    cwToken: process.env.CHATWOOT_API_TOKEN || process.env.CW_ADMIN_TOKEN || '',
    portalUrl: 'https://portal.pontualtech.com.br/portal/pontualtech/login',
    supportWhatsApp: 'https://wa.me/551126263841',
    botOrigin: 'whatsapp_bot_ana',
    botAgentId: 6, // Ana agent in PontualTech Chatwoot
  },
  imprimitech: {
    companyId: process.env.BOT_IMPRI_COMPANY_ID || '86c829cf-32ed-4e40-80cd-59ce4178aa1a',
    slug: 'imprimitech',
    allowedInboxes: [3],
    difyBaseUrl: process.env.DIFY_IMPRI_BASE_URL || 'https://dify.imprimitech.com.br',
    difyApiKey: process.env.DIFY_IMPRI_API_KEY || 'app-X5O39z2STNNpj92FUfMnzwlQ',
    botApiKey: process.env.BOT_IMPRI_API_KEY || '',
    cwUrl: process.env.CW_IMPRI_URL || 'https://chat.imp.pontualtech.work',
    cwAccountId: process.env.CW_IMPRI_ACCOUNT_ID || '1',
    cwToken: process.env.CW_IMPRI_TOKEN || 'PmZodW8CiMzCvN8oTVa3Lk2S',
    portalUrl: 'https://portal.imprimitech.com.br/portal/imprimitech/login',
    supportWhatsApp: 'https://wa.me/551150439869',
    botOrigin: 'whatsapp_bot_grazi',
    botAgentId: 9, // Grazi agent in Imprimitech Chatwoot
  },
}

// Default to pontualtech for backward compatibility
function getCompanyConfig(companySlug?: string | null): BotCompanyConfig | null {
  if (!companySlug) return COMPANY_CONFIGS.pontualtech
  return COMPANY_CONFIGS[companySlug] || null
}

// These are set per-request now, but we keep defaults for backward compat
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const ERP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'

// Legacy constants (used by functions that don't have config context yet)
let ALLOWED_INBOXES = [2, 4, 9]
let COMPANY_ID = process.env.BOT_ANA_COMPANY_ID || 'pontualtech-001'
let DIFY_BASE_URL = process.env.DIFY_BASE_URL || 'https://dify.pontualtech.work'
let DIFY_API_KEY = process.env.DIFY_API_KEY || ''
let BOT_API_KEY = process.env.BOT_ANA_API_KEY || ''
let CW_URL = process.env.CHATWOOT_URL || 'https://chat.pontualtech.work'
let CW_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '1'
let CW_TOKEN = process.env.CHATWOOT_API_TOKEN || process.env.CW_ADMIN_TOKEN || ''
let PORTAL_URL = 'https://portal.pontualtech.com.br/portal/pontualtech/login'
let SUPPORT_WHATSAPP = 'https://wa.me/551126263841'
let BOT_ORIGIN = 'whatsapp_bot_ana'
let BOT_AGENT_ID = 6

const DEBOUNCE_MS = 4000 // 4s debounce window — wait for client to finish typing
const MAX_HISTORY = 20   // keep last 20 messages

// ---------------------------------------------------------------------------
// Chatwoot API helpers
// ---------------------------------------------------------------------------

function cwBase() {
  return `${CW_URL}/api/v1/accounts/${CW_ACCOUNT_ID}`
}

function cwHeaders() {
  return {
    'Content-Type': 'application/json',
    api_access_token: CW_TOKEN,
  }
}

async function cwSendMessage(conversationId: number, content: string, isPrivate = false) {
  const res = await fetch(`${cwBase()}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: cwHeaders(),
    body: JSON.stringify({
      content,
      message_type: 'outgoing',
      private: isPrivate,
      content_attributes: { bot_sent: true },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`[Bot] Chatwoot send failed ${res.status}: ${body}`)
  }
}

async function cwSetLabels(conversationId: number, labels: string[]) {
  // Get current labels first
  const convRes = await fetch(`${cwBase()}/conversations/${conversationId}`, {
    headers: cwHeaders(),
  })
  let currentLabels: string[] = []
  if (convRes.ok) {
    const conv = await convRes.json()
    currentLabels = conv.labels || []
  }
  const merged = [...new Set([...currentLabels, ...labels])]

  await fetch(`${cwBase()}/conversations/${conversationId}/labels`, {
    method: 'POST',
    headers: cwHeaders(),
    body: JSON.stringify({ labels: merged }),
  })
}

async function cwResolve(conversationId: number) {
  await fetch(`${cwBase()}/conversations/${conversationId}/toggle_status`, {
    method: 'POST',
    headers: cwHeaders(),
    body: JSON.stringify({ status: 'resolved' }),
  })
}

/**
 * Send response split by paragraphs with delays for simulated typing.
 */
async function cwSendWithTyping(conversationId: number, text: string) {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
  if (paragraphs.length <= 1) {
    await cwSendMessage(conversationId, text)
    return
  }
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, 1200))
    }
    await cwSendMessage(conversationId, paragraphs[i].trim())
  }
}

// ---------------------------------------------------------------------------
// Dify API
// ---------------------------------------------------------------------------

interface DifyResponse {
  answer: string
  conversation_id: string
}

async function callDify(
  query: string,
  user: string,
  conversationId?: string,
  imageUrls?: string[]
): Promise<DifyResponse> {
  const payload: Record<string, unknown> = {
    inputs: {},
    query,
    response_mode: 'blocking',
    user,
  }
  if (conversationId) {
    payload.conversation_id = conversationId
  }
  // Send images/videos to Dify for Gemini Vision processing
  if (imageUrls && imageUrls.length > 0) {
    payload.files = imageUrls.map(url => {
      const isVideo = /\.(mp4|mov|avi|webm|mkv|3gp)/i.test(url) || url.includes('video')
      return {
        type: isVideo ? 'video' : 'image',
        transfer_method: 'remote_url',
        url,
      }
    })
  }

  const res = await fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DIFY_API_KEY}`,
    },
    body: JSON.stringify(payload),
  })

  if (res.ok) {
    const data = await res.json()
    return {
      answer: data.answer || '',
      conversation_id: data.conversation_id || '',
    }
  }

  // Fallback: try streaming mode (some Dify+Gemini combos don't support blocking)
  console.warn(`[Bot] Dify blocking failed (${res.status}), trying streaming...`)

  const streamPayload = { ...payload, response_mode: 'streaming' }
  const streamRes = await fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DIFY_API_KEY}`,
    },
    body: JSON.stringify(streamPayload),
  })

  if (!streamRes.ok) {
    const errBody = await streamRes.text()
    throw new Error(`Dify API ${streamRes.status}: ${errBody}`)
  }

  const rawResponse = await streamRes.text()
  let fullAnswer = ''
  let difyConvId = ''

  for (const line of rawResponse.split('\n')) {
    if (line.startsWith('data:')) {
      try {
        const evt = JSON.parse(line.slice(5).trim())
        if (evt.answer) fullAnswer += evt.answer
        if (evt.conversation_id) difyConvId = evt.conversation_id
      } catch {
        // skip unparseable lines
      }
    }
  }

  return { answer: fullAnswer, conversation_id: difyConvId }
}

// ---------------------------------------------------------------------------
// Audio transcription (Groq Whisper)
// ---------------------------------------------------------------------------

async function transcribeAudio(audioUrl: string): Promise<string> {
  if (!GROQ_API_KEY) {
    console.warn('[Bot] GROQ_API_KEY not set, skipping audio transcription')
    return ''
  }

  try {
    // Download audio file
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      console.error(`[Bot] Failed to download audio: ${audioRes.status}`)
      return ''
    }

    const audioBuffer = await audioRes.arrayBuffer()
    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg')
    formData.append('model', 'whisper-large-v3')
    formData.append('language', 'pt')
    formData.append('response_format', 'text')

    const transcribeRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    })

    if (!transcribeRes.ok) {
      const errBody = await transcribeRes.text()
      console.error(`[Bot] Groq transcription failed ${transcribeRes.status}: ${errBody}`)
      return ''
    }

    const transcript = await transcribeRes.text()
    return transcript.trim()
  } catch (err) {
    console.error('[Bot] Audio transcription error:', err)
    return ''
  }
}

// ---------------------------------------------------------------------------
// Tag parser — detect action tags from Dify response
// ---------------------------------------------------------------------------

interface ParsedResponse {
  cleanText: string
  vhsysData: Record<string, unknown> | null
  action: 'ABRIR_OS' | 'ENCERRAR_CONVERSA' | 'TRANSFERIR_HUMANO' | 'NENHUMA_ACAO' | null
}

function parseDifyResponse(text: string): ParsedResponse {
  let cleanText = text
  let vhsysData: Record<string, unknown> | null = null
  let action: ParsedResponse['action'] = null

  // Extract [VHSYS_DATA]{json}[/VHSYS_DATA]
  const dataMatch = text.match(/\[VHSYS_DATA\]([\s\S]+?)\[\/VHSYS_DATA\]/)
  if (dataMatch) {
    try {
      vhsysData = JSON.parse(dataMatch[1].trim())
    } catch {
      console.error('[Bot] Failed to parse VHSYS_DATA JSON')
    }
    cleanText = cleanText.replace(/\[VHSYS_DATA\]([\s\S]+?)\[\/VHSYS_DATA\]/, '').trim()
  }

  // Detect action tags
  if (text.includes('[ABRIR_OS]')) {
    action = 'ABRIR_OS'
    cleanText = cleanText.replace(/\[ABRIR_OS\]/g, '').trim()
  } else if (text.includes('[ENCERRAR_CONVERSA]')) {
    action = 'ENCERRAR_CONVERSA'
    cleanText = cleanText.replace(/\[ENCERRAR_CONVERSA\]/g, '').trim()
  } else if (text.includes('[TRANSFERIR_HUMANO]')) {
    action = 'TRANSFERIR_HUMANO'
    cleanText = cleanText.replace(/\[TRANSFERIR_HUMANO\]/g, '').trim()
  } else if (text.includes('[NENHUMA_ACAO]')) {
    action = 'NENHUMA_ACAO'
    cleanText = cleanText.replace(/\[NENHUMA_ACAO\]/g, '').trim()
  }

  return { cleanText, vhsysData, action }
}

// ---------------------------------------------------------------------------
// Message history helpers
// ---------------------------------------------------------------------------

interface HistoryEntry {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

function addToHistory(
  history: HistoryEntry[],
  role: 'user' | 'assistant',
  content: string
): HistoryEntry[] {
  const updated = [...history, { role, content, ts: Date.now() }]
  return updated.slice(-MAX_HISTORY)
}

function getRecentMessages(history: HistoryEntry[], withinMs: number): HistoryEntry[] {
  const cutoff = Date.now() - withinMs
  return history.filter(m => m.role === 'user' && m.ts >= cutoff)
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // Multi-tenant: select company config by ?company= param (default: pontualtech)
  const companySlug = req.nextUrl.searchParams.get('company') || 'pontualtech'
  const cfg = getCompanyConfig(companySlug)
  if (!cfg) {
    console.warn(`[Bot] Unknown company slug: ${companySlug}`)
    return NextResponse.json({ status: 'ignored', reason: 'unknown company' })
  }
  // CRITICAL: Set module-level vars atomically before any await.
  // These are read by helper functions (cwBase, cwHeaders, callDify, etc.)
  // that don't receive cfg as parameter. This is safe because Node.js is
  // single-threaded and no await happens between these assignments.
  ALLOWED_INBOXES = cfg.allowedInboxes
  COMPANY_ID = cfg.companyId
  DIFY_BASE_URL = cfg.difyBaseUrl
  DIFY_API_KEY = cfg.difyApiKey
  BOT_API_KEY = cfg.botApiKey
  CW_URL = cfg.cwUrl
  CW_ACCOUNT_ID = cfg.cwAccountId
  CW_TOKEN = cfg.cwToken
  PORTAL_URL = cfg.portalUrl
  SUPPORT_WHATSAPP = cfg.supportWhatsApp
  BOT_ORIGIN = cfg.botOrigin
  BOT_AGENT_ID = cfg.botAgentId

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Log webhook receipt to DB (diagnostic — proves webhook is arriving)
  const convId = body.conversation?.id || 0
  const event = body.event || '?'
  const msgType = body.message_type
  const senderType = body.sender?.type || '?'
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO bot_conversations (id, company_id, chatwoot_conv_id, step, data, message_history, created_at, updated_at)
       VALUES (gen_random_uuid(), 'LOG', $1, $2, '{}', '[]', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      99999000 + Math.floor(Math.random() * 999),
      `LOG:${event}|mt:${msgType}|st:${senderType}|cv:${convId}`
    )
  } catch {}

  // Process synchronously
  try {
    await processWebhook(body)
  } catch (err: any) {
    console.error('[Bot] Error:', err.message || err)
  }

  return NextResponse.json({ status: 'ok' })
}

export const maxDuration = 120 // 2 min timeout

// ---------------------------------------------------------------------------
// Async webhook processor
// ---------------------------------------------------------------------------

async function processWebhook(body: any) {
  const event = body.event

  // Handle conversation resolved — reset bot state
  if (event === 'conversation_status_changed') {
    const status = body.status || body.conversation?.status
    const convId = body.id || body.conversation?.id
    if (status === 'resolved' && convId) {
      await prisma.botConversation.updateMany({
        where: { chatwoot_conv_id: convId },
        data: {
          human_takeover: false,
          dify_conv_id: null,
          step: 'IDLE',
          data: '{}',
        },
      })
      console.log(`[Bot] Conversation ${convId} resolved — state reset`)
    }
    return
  }

  // Handle agent assignment — human takeover (skip if assigned to bot's own agent)
  if (event === 'conversation_updated') {
    const convId = body.id || body.conversation?.id
    const assignee = body.assignee || body.conversation?.meta?.assignee
    if (convId && assignee && assignee.id !== BOT_AGENT_ID) {
      await prisma.botConversation.updateMany({
        where: { chatwoot_conv_id: convId },
        data: { human_takeover: true, step: 'HUMAN' },
      })
      console.log(`[Bot] Conversation ${convId} assigned to ${assignee.name} (ID ${assignee.id}) — human takeover`)
    }
    return
  }

  // Only process message_created
  if (event !== 'message_created') return

  // Detect outgoing messages from HUMAN agents → activate human takeover
  const messageType = body.message_type
  const isOutgoing = messageType === 'outgoing' || messageType === 1
  const senderType = body.sender?.type || ''
  const outgoingConvId: number = body.conversation?.id

  if (isOutgoing && !body.private && outgoingConvId) {
    // Check if this outgoing message was sent by the bot itself.
    // Bot messages have content_attributes.bot_sent = true (set in cwSendMessage).
    // Human messages typed in the Chatwoot UI don't have this flag.
    const contentAttrs = body.content_attributes || {}
    const isBotMessage = contentAttrs.bot_sent === true

    if (!isBotMessage && (senderType === 'user' || senderType === 'User')) {
      // A real human agent typed a message — activate takeover
      const botConv = await prisma.botConversation.findUnique({
        where: { chatwoot_conv_id: outgoingConvId },
        select: { human_takeover: true },
      })
      // Only activate if bot is currently active (not already in takeover)
      if (botConv && !botConv.human_takeover) {
        await prisma.botConversation.update({
          where: { chatwoot_conv_id: outgoingConvId },
          data: { human_takeover: true, step: 'HUMAN' },
        })
        console.log(`[Bot] Human agent ${body.sender?.name} sent message in conv ${outgoingConvId} — human takeover activated`)
      }
    }
    return
  }

  // Only process incoming messages from customers
  const isIncoming = messageType === 'incoming' || messageType === 0
  if (!isIncoming) return

  // Ignore agent/bot outgoing messages
  if (senderType === 'user' || senderType === 'agent_bot' || senderType === 'User') return

  // Ignore private notes
  if (body.private) return

  // Filter by allowed inboxes
  const inboxId = body.inbox?.id || body.conversation?.inbox_id
  if (inboxId && !ALLOWED_INBOXES.includes(inboxId)) {
    return
  }

  const conversationId: number = body.conversation?.id
  if (!conversationId) return

  const messageId = body.id?.toString() || ''

  // Extract content and handle audio
  let content = body.content?.trim() || ''

  // Process attachments: audio, images, video, documents
  const attachments = body.attachments || body.conversation?.messages?.[0]?.attachments || []
  const imageUrls: string[] = []

  for (const att of attachments) {
    const fileType = att.file_type || ''
    const url = att.data_url || att.url || ''
    if (!url) continue

    if (fileType === 'audio') {
      const transcript = await transcribeAudio(url)
      if (transcript) {
        content = `[Audio transcrito]: ${transcript}\n\n${content}`.trim()
      }
    } else if (fileType === 'image') {
      imageUrls.push(url)
      content = `${content}\n[Imagem enviada pelo cliente]`.trim()
    } else if (fileType === 'video') {
      imageUrls.push(url) // Gemini 2.5 Flash supports video via same files API
      content = `${content}\n[Video enviado pelo cliente - analise o conteudo]`.trim()
    } else if (fileType === 'file') {
      content = `${content}\n[Documento enviado: ${att.file_name || url}]`.trim()
    }
  }

  if (!content && imageUrls.length === 0) return

  // Extract sender info
  const sender = body.sender || body.conversation?.meta?.sender || {}
  const phone = sender.phone_number || sender.phone || ''
  const contactId = sender.id || body.conversation?.contact_inbox?.contact?.id

  console.log(`[Bot] Message from ${phone || 'unknown'} in conv ${conversationId}: ${content.substring(0, 80)}`)

  // Find or create BotConversation (atomic upsert to prevent race conditions)
  const isNew = !(await prisma.botConversation.findUnique({ where: { chatwoot_conv_id: conversationId }, select: { id: true } }))
  let botConv = await prisma.botConversation.upsert({
    where: { chatwoot_conv_id: conversationId },
    update: {}, // don't overwrite existing data
    create: {
      company_id: COMPANY_ID,
      chatwoot_conv_id: conversationId,
      chatwoot_contact_id: contactId || null,
      customer_phone: phone || null,
      inbox_id: inboxId || null,
      step: 'IDLE',
      data: {},
      message_history: [],
    },
  })

  if (isNew) {
    // Assign conversation to bot agent so messages show as bot's name
    fetch(`${cwBase()}/conversations/${conversationId}/assignments`, {
      method: 'POST',
      headers: cwHeaders(),
      body: JSON.stringify({ assignee_id: BOT_AGENT_ID }),
    }).catch(() => {})
  }

  // Idempotency check
  if (messageId && botConv.last_message_id === messageId) {
    console.log(`[Bot] Duplicate message ${messageId}, skipping`)
    return
  }

  // Human takeover check
  if (botConv.human_takeover) {
    console.log(`[Bot] Conv ${conversationId} in human takeover mode, skipping`)
    return
  }

  // Debounce: consolidate recent messages from last 5s
  const history = (botConv.message_history || []) as unknown as HistoryEntry[]
  const updatedHistory = addToHistory(history, 'user', content)

  // Save message to history and update last_message_id
  await prisma.botConversation.update({
    where: { id: botConv.id },
    data: {
      message_history: updatedHistory as any,
      last_message_id: messageId,
      customer_phone: phone || botConv.customer_phone,
      chatwoot_contact_id: contactId || botConv.chatwoot_contact_id,
      last_user_msg_at: new Date(),
    },
  })

  // DEBOUNCE: Check if another message arrived recently.
  // If the previous message was less than DEBOUNCE_MS ago, skip —
  // the next message's webhook will consolidate and process everything.
  const prevMsgTime = botConv.last_user_msg_at ? new Date(botConv.last_user_msg_at).getTime() : 0
  const timeSincePrev = Date.now() - prevMsgTime
  if (prevMsgTime > 0 && timeSincePrev < DEBOUNCE_MS) {
    console.log(`[Bot] Debounce: msg arrived ${timeSincePrev}ms after previous, skipping (will be consolidated by next)`)
    return NextResponse.json({ status: 'ok', debounced: true })
  }

  // This message is the first after a pause — consolidate recent messages
  const recentUserMsgs = getRecentMessages(updatedHistory, DEBOUNCE_MS + 1000)
  let query = content

  if (recentUserMsgs.length > 1) {
    query = recentUserMsgs.map(m => m.content).join('\n')
    console.log(`[Bot] Consolidated ${recentUserMsgs.length} messages into one query`)
  }

  // Handle OS confirmation flow
  if (botConv.step === 'AWAITING_CONFIRMATION') {
    await handleOSConfirmation(botConv, content, conversationId)
    return
  }

  // Call Dify
  try {
    const userIdentifier = phone || contactId?.toString() || `conv_${conversationId}`
    const difyResponse = await callDify(
      query,
      userIdentifier,
      botConv.dify_conv_id || undefined,
      imageUrls.length > 0 ? imageUrls : undefined
    )

    if (!difyResponse.answer) {
      console.warn('[Bot] Empty Dify response — sending fallback and activating human takeover')
      await cwSendMessage(conversationId, 'Ops, tive um probleminha aqui! 😅 Vou chamar alguem da equipe pra te ajudar, ta? Um momentinho!')
      await prisma.botConversation.update({
        where: { id: botConv.id },
        data: { human_takeover: true, step: 'HUMAN' },
      })
      return
    }

    // Parse response for action tags
    const parsed = parseDifyResponse(difyResponse.answer)

    // Save dify_conv_id and update history
    const assistantHistory = addToHistory(updatedHistory, 'assistant', parsed.cleanText)

    const updateData: any = {
      dify_conv_id: difyResponse.conversation_id || botConv.dify_conv_id,
      message_history: assistantHistory as any,
    }

    // Handle action tags
    if (parsed.action === 'ABRIR_OS' && parsed.vhsysData) {
      // Ana already confirmed with client — create OS immediately
      try {
        const erpResp = await fetch(`${ERP_BASE_URL}/api/bot/abrir-os`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Bot-Key': BOT_API_KEY },
          body: JSON.stringify({
            nome: parsed.vhsysData.nome || parsed.vhsysData.cliente || sender.name || 'Cliente WhatsApp',
            documento: parsed.vhsysData.cpf_cnpj || '',
            telefone: parsed.vhsysData.telefone || phone || '',
            email: parsed.vhsysData.email || '',
            cep: parsed.vhsysData.cep || '',
            endereco: parsed.vhsysData.endereco || '',
            equipamento: parsed.vhsysData.equipamento || 'Impressora',
            marca: parsed.vhsysData.marca || '',
            modelo: parsed.vhsysData.modelo || '',
            defeito: parsed.vhsysData.defeito || 'Sem descricao',
            origem: BOT_ORIGIN,
          }),
        })
        const erpData = await erpResp.json()
        const osNum = erpData.os_numero || 0
        const clienteNome = erpData.cliente_nome || parsed.vhsysData.nome || 'Cliente'
        if (osNum > 0) {
          await cwSendMessage(conversationId, `✅ *OS #${osNum}* aberta para ${clienteNome}!\n\n📱 Acompanhe pelo portal:\n${PORTAL_URL}\n\n📞 Suporte: ${SUPPORT_WHATSAPP}`)
          // Private note with all links for agents (always visible in conversation)
          const vdNote = parsed.vhsysData as Record<string, any>
          const noteLines = [
            `📋 *OS #${osNum}* — ${clienteNome}${erpData.cliente_novo ? ' (NOVO)' : ''}`,
            `🖨️ ${String(vdNote.marca || '')} ${String(vdNote.modelo || '')} — ${String(vdNote.defeito || '')}`,
            `📄 CPF: ${String(vdNote.cpf_cnpj || 'N/I')} | 📞 ${String(vdNote.telefone || phone || 'N/I')}`,
            `📧 ${String(vdNote.email || 'N/I')} | 📍 ${String(vdNote.endereco || 'N/I')}`,
            ``,
            `🔗 ERP: ${ERP_BASE_URL}/os/${osNum}`,
            `🔗 Portal: ${PORTAL_URL}`,
          ]
          await cwSendMessage(conversationId, noteLines.join('\n'), true)
          await cwSetLabels(conversationId, ['os_aberta'])

          // Sync contact data to Chatwoot (keep CRM in sync with ERP)
          if (contactId) {
            const vd = parsed.vhsysData as Record<string, any>
            const contactUpdate: Record<string, unknown> = {}
            if (vd.nome) contactUpdate.name = String(vd.nome)
            if (vd.email) contactUpdate.email = String(vd.email)
            if (vd.telefone) contactUpdate.phone_number = '+55' + String(vd.telefone).replace(/\D/g, '')
            contactUpdate.custom_attributes = {
              cpf_cnpj: String(vd.cpf_cnpj || ''),
              endereco: String(vd.endereco || ''),
              cep: String(vd.cep || ''),
              marca: String(vd.marca || ''),
              modelo: String(vd.modelo || ''),
              ultima_os: String(osNum),
              erp_os_link: `${ERP_BASE_URL}/os/${osNum}`,
              portal_link: PORTAL_URL,
              erp_cliente_id: String(erpData.cliente_id || ''),
            }
            try {
              const syncResp = await fetch(`${cwBase()}/contacts/${contactId}`, {
                method: 'PUT',
                headers: cwHeaders(),
                body: JSON.stringify(contactUpdate),
              })
              if (!syncResp.ok) console.error('[Bot] Contact sync failed:', syncResp.status)
              else console.log('[Bot] Contact synced:', contactId)
            } catch (e) { console.error('[Bot] Contact sync error:', e) }

            // Also update conversation sidebar with OS info
            try {
              const convResp = await fetch(`${cwBase()}/conversations/${conversationId}/custom_attributes`, {
                method: 'PATCH',
                headers: cwHeaders(),
                body: JSON.stringify({
                  custom_attributes: {
                    os_numero: String(osNum),
                    os_status: 'Coletar',
                    equipamento: `${String(vd.marca || '')} ${String(vd.modelo || '')}`.trim() || 'Impressora',
                  },
                }),
              })
              if (!convResp.ok) console.error('[Bot] Conversation custom_attributes sync failed:', convResp.status)
            } catch (e) { console.error('[Bot] Conversation sync error:', e) }

            // Save Chatwoot conversation link to ERP customer
            if (erpData.cliente_id) {
              try {
                await fetch(`${ERP_BASE_URL}/api/bot/atualizar-cliente`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', 'X-Bot-Key': BOT_API_KEY },
                  body: JSON.stringify({
                    cliente_id: erpData.cliente_id,
                    chatwoot_contact_id: String(contactId),
                    chatwoot_url: `${CW_URL}/app/accounts/${CW_ACCOUNT_ID}/conversations/${conversationId}`,
                  }),
                })
              } catch (e) { console.error('[Bot] ERP customer update error:', e) }
            }
          }
        } else {
          await cwSendMessage(conversationId, '[BOT] Erro ao criar OS: ' + (erpData.erro || 'desconhecido'), true)
        }
      } catch (erpErr) {
        console.error('[Bot] ERP abrir-os error:', erpErr)
        await cwSendMessage(conversationId, '[BOT] Excecao ao criar OS. Verificar logs.', true)
      }
      updateData.step = 'IDLE'
      updateData.data = {}
    } else if (parsed.action === 'TRANSFERIR_HUMANO') {
      updateData.human_takeover = true
      updateData.step = 'HUMAN'
      await cwSendMessage(conversationId, '[BOT] Cliente solicitou atendente humano.', true)
    } else if (parsed.action === 'ENCERRAR_CONVERSA') {
      updateData.step = 'IDLE'
      updateData.data = {}
    }

    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: updateData,
    })

    // Send response to client
    if (parsed.cleanText) {
      await cwSendWithTyping(conversationId, parsed.cleanText)
    }

    // Post-send actions
    if (parsed.action === 'ENCERRAR_CONVERSA') {
      await new Promise(r => setTimeout(r, 2000))
      await cwResolve(conversationId)
    }

    // Log to chatbot_logs
    await logBotMessage(conversationId, content, parsed.cleanText, parsed.action || 'CHAT', phone)
  } catch (err) {
    console.error('[Bot] Dify call error:', err)
    await cwSendMessage(
      conversationId,
      'Desculpe, estou com dificuldade para processar sua mensagem. Um atendente sera notificado.'
    )
    await cwSendMessage(conversationId, '[BOT] Erro ao chamar Dify AI. Verificar logs.', true)
  }
}

// ---------------------------------------------------------------------------
// OS Confirmation handler
// ---------------------------------------------------------------------------

async function handleOSConfirmation(
  botConv: any,
  content: string,
  conversationId: number
) {
  const normalized = content.toLowerCase().trim()
  const isConfirm = ['sim', 'confirmo', 'confirma', 'ok', 'pode abrir', 'abre', 's', 'yes'].some(
    w => normalized === w || normalized.startsWith(w)
  )
  const isReject = ['nao', 'n', 'no', 'cancela', 'cancelar', 'nope'].some(
    w => normalized === w || normalized.startsWith(w)
  )

  if (isConfirm) {
    const osData = botConv.data as Record<string, unknown>

    try {
      // Call the existing abrir-os API
      const res = await fetch(`${ERP_BASE_URL}/api/bot/abrir-os`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Key': BOT_API_KEY,
        },
        body: JSON.stringify({
          nome: osData.nome || osData.cliente_nome || osData.name,
          telefone: osData.telefone || osData.phone || botConv.customer_phone,
          documento: osData.documento || osData.cpf || osData.cnpj,
          email: osData.email,
          equipamento: osData.equipamento || osData.equipment,
          marca: osData.marca || osData.brand,
          modelo: osData.modelo || osData.model,
          defeito: osData.defeito || osData.issue || osData.problema,
          observacoes: osData.observacoes || osData.obs,
          cep: osData.cep,
          endereco: osData.endereco,
          origem: 'bot_dify',
        }),
      })

      const result = await res.json()

      if (result.ok) {
        await cwSendMessage(
          conversationId,
          `OS #${result.dados?.os_numero || result.data?.os_numero} criada com sucesso! Voce recebera atualizacoes sobre o andamento do servico.`
        )
        await cwSetLabels(conversationId, ['os_criada_bot'])
      } else {
        await cwSendMessage(
          conversationId,
          `Houve um erro ao criar a OS: ${result.erro || result.error || 'Erro desconhecido'}. Um atendente vai ajudar voce.`
        )
        await cwSendMessage(conversationId, `[BOT] Erro ao criar OS: ${JSON.stringify(result)}`, true)
      }
    } catch (err: any) {
      console.error('[Bot] OS creation error:', err)
      await cwSendMessage(
        conversationId,
        'Desculpe, houve um erro tecnico ao abrir a OS. Um atendente sera notificado.'
      )
      await cwSendMessage(conversationId, `[BOT] Erro tecnico abrir-os: ${err.message}`, true)
    }

    // Reset state
    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: { step: 'IDLE', data: {} },
    })
  } else if (isReject) {
    await cwSendMessage(conversationId, 'Tudo bem, a abertura da OS foi cancelada. Se precisar de algo mais, e so me dizer!')
    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: { step: 'IDLE', data: {} },
    })
  } else {
    // Unclear — re-ask or forward to Dify for interpretation
    await cwSendMessage(
      conversationId,
      'Por favor, confirme: deseja abrir a OS? Responda *sim* para confirmar ou *nao* para cancelar.'
    )
  }
}

// ---------------------------------------------------------------------------
// Human agent detection
// ---------------------------------------------------------------------------

async function handleHumanAgentMessage(body: any) {
  const conversationId = body.conversation?.id
  if (!conversationId) return

  // Check if this is from the bot itself (ignore)
  // The bot sends messages using CW_ADMIN_TOKEN — these come back as outgoing
  // from the admin user. Ignore them to avoid self-triggering human takeover.
  const senderType = body.sender?.type
  if (senderType === 'agent_bot') return

  // Ignore messages that the bot just sent (check if content starts with bot markers)
  const content = body.content || ''
  if (content.startsWith('[BOT') || content.startsWith('✅') || content.startsWith('*Pronto')) return

  // If the outgoing message was sent within 2s of the last bot response, it's likely the bot itself
  const botConvCheck = await prisma.botConversation.findUnique({ where: { chatwoot_conv_id: conversationId } })
  if (botConvCheck) {
    const lastUpdate = new Date(botConvCheck.updated_at).getTime()
    const now = Date.now()
    if (now - lastUpdate < 5000) return // Message sent within 5s of bot activity — likely the bot
  }

  // An actual human agent sent a message — set takeover
  const botConv = await prisma.botConversation.findUnique({
    where: { chatwoot_conv_id: conversationId },
  })

  if (botConv && !botConv.human_takeover) {
    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: { human_takeover: true, step: 'HUMAN' },
    })
    console.log(`[Bot] Human agent detected in conv ${conversationId} — takeover enabled`)
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

async function logBotMessage(
  conversationId: number,
  userMessage: string,
  botResponse: string,
  action: string,
  phone?: string
) {
  try {
    await prisma.chatbotLog.create({
      data: {
        company_id: COMPANY_ID,
        customer_phone: phone || null,
        intent: action,
        message_in: userMessage.substring(0, 2000),
        message_out: botResponse.substring(0, 2000),
        provider: 'dify',
        model: 'dify-gemini',
        status: action === 'TRANSFERIR_HUMANO' ? 'transferred' : 'bot',
      },
    })
  } catch (err) {
    console.error('[Bot] Failed to log:', err)
  }
}
