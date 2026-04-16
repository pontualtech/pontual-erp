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
import {
  sendWhatsAppButtons,
  sendWhatsAppList,
  sendWhatsAppCtaUrl,
  type ReplyButton,
  type ListRow,
} from '@/lib/whatsapp/cloud-api'

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

// ENV-based fallbacks (API keys MUST stay in env vars for security)
const ENV_CONFIGS: Record<string, Partial<BotCompanyConfig> & { settingsPrefix?: string }> = {
  pontualtech: {
    companyId: process.env.BOT_ANA_COMPANY_ID || 'pontualtech-001',
    difyApiKey: process.env.DIFY_API_KEY || '',
    botApiKey: process.env.BOT_ANA_API_KEY || '',
    cwToken: process.env.CHATWOOT_API_TOKEN || process.env.CW_ADMIN_TOKEN || '',
  },
  'pontualtech-suporte': {
    companyId: process.env.BOT_ANA_COMPANY_ID || 'pontualtech-001',
    difyApiKey: process.env.DIFY_SUPORTE_API_KEY || '',
    botApiKey: process.env.BOT_ANA_API_KEY || '',
    cwToken: process.env.CHATWOOT_API_TOKEN || process.env.CW_ADMIN_TOKEN || '',
    settingsPrefix: 'bot.marta.config.',
  },
  imprimitech: {
    companyId: process.env.BOT_IMPRI_COMPANY_ID || '86c829cf-32ed-4e40-80cd-59ce4178aa1a',
    difyApiKey: process.env.DIFY_IMPRI_API_KEY || '',
    botApiKey: process.env.BOT_IMPRI_API_KEY || '',
    cwToken: process.env.CW_IMPRI_TOKEN || '',
  },
}

// DB-loaded config cache (5 min TTL)
const botConfigCache = new Map<string, { cfg: BotCompanyConfig; ts: number }>()
const BOT_CFG_TTL = 5 * 60 * 1000

async function getCompanyConfig(companySlug?: string | null): Promise<BotCompanyConfig | null> {
  const slug = companySlug || 'pontualtech'
  const envCfg = ENV_CONFIGS[slug]
  if (!envCfg?.companyId) return null

  // Check cache
  const cached = botConfigCache.get(slug)
  if (cached && Date.now() - cached.ts < BOT_CFG_TTL) return cached.cfg
  if (botConfigCache.size >= CACHE_MAX) botConfigCache.clear()

  // Load from DB settings (custom prefix for multi-bot per company)
  const prefix = (envCfg as any).settingsPrefix || 'bot.config.'
  const settings = await prisma.setting.findMany({
    where: { company_id: envCfg.companyId, key: { startsWith: prefix } },
  })
  const dbCfg: Record<string, string> = {}
  for (const s of settings) {
    // Normalize key: remove prefix, then re-add as 'bot.config.' for uniform access
    const normalizedKey = 'bot.config.' + s.key.slice(prefix.length)
    dbCfg[normalizedKey] = s.value
  }

  const cfg: BotCompanyConfig = {
    companyId: envCfg.companyId!,
    slug: dbCfg['bot.config.slug'] || slug,
    allowedInboxes: (dbCfg['bot.config.allowed_inboxes'] || '2,4,9').split(',').map(Number),
    difyBaseUrl: dbCfg['bot.config.dify_base_url'] || `https://dify.${slug.startsWith('pontualtech') ? 'pontualtech.work' : 'imprimitech.com.br'}`,
    difyApiKey: envCfg.difyApiKey || '',
    botApiKey: envCfg.botApiKey || '',
    cwUrl: dbCfg['bot.config.cw_url'] || `https://chat.${slug.startsWith('pontualtech') ? 'pontualtech.work' : 'imp.pontualtech.work'}`,
    cwAccountId: dbCfg['bot.config.cw_account_id'] || '1',
    cwToken: envCfg.cwToken || '',
    portalUrl: dbCfg['bot.config.portal_url'] || '',
    supportWhatsApp: dbCfg['bot.config.support_whatsapp'] || '',
    botOrigin: dbCfg['bot.config.bot_origin'] || `whatsapp_bot_${slug}`,
    botAgentId: parseInt(dbCfg['bot.config.bot_agent_id'] || '0'),
  }

  botConfigCache.set(slug, { cfg, ts: Date.now() })
  return cfg
}

// Immutable constants (safe across concurrent requests)
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const ERP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'

const DEBOUNCE_WAIT_MS = 3000 // 3s — wait for client to finish typing before processing
const LOCK_EXPIRE_MS = 15000  // 15s — lock auto-expires if holder crashes
const MAX_HISTORY = 20        // keep last 20 messages

// ---------------------------------------------------------------------------
// Chatwoot API helpers
// ---------------------------------------------------------------------------

// All Chatwoot helpers now receive cfg to avoid module-level mutable state (race-condition safe)
function cwBase(cfg: BotCompanyConfig) {
  return `${cfg.cwUrl}/api/v1/accounts/${cfg.cwAccountId}`
}

function cwHeaders(cfg: BotCompanyConfig) {
  return {
    'Content-Type': 'application/json',
    api_access_token: cfg.cwToken,
  }
}

async function cwSendMessage(cfg: BotCompanyConfig, conversationId: number, content: string, isPrivate = false): Promise<boolean> {
  try {
    const res = await fetch(`${cwBase(cfg)}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: cwHeaders(cfg),
      body: JSON.stringify({
        content,
        message_type: 'outgoing',
        private: isPrivate,
        content_attributes: { bot_sent: true },
      }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[Bot] Chatwoot send failed ${res.status}: ${body}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[Bot] Chatwoot send error:`, err instanceof Error ? err.message : err)
    return false
  }
}

async function cwSetLabels(cfg: BotCompanyConfig, conversationId: number, labels: string[]) {
  const convRes = await fetch(`${cwBase(cfg)}/conversations/${conversationId}`, {
    headers: cwHeaders(cfg),
  })
  let currentLabels: string[] = []
  if (convRes.ok) {
    const conv = await convRes.json()
    currentLabels = conv.labels || []
  }
  const merged = [...new Set([...currentLabels, ...labels])]

  await fetch(`${cwBase(cfg)}/conversations/${conversationId}/labels`, {
    method: 'POST',
    headers: cwHeaders(cfg),
    body: JSON.stringify({ labels: merged }),
  })
}

async function cwResolve(cfg: BotCompanyConfig, conversationId: number) {
  await fetch(`${cwBase(cfg)}/conversations/${conversationId}/toggle_status`, {
    method: 'POST',
    headers: cwHeaders(cfg),
    body: JSON.stringify({ status: 'resolved' }),
  })
}

/**
 * Clean and send bot response to client.
 *
 * Robust output filter — no matter what the AI returns:
 * 1. Removes duplicate/similar paragraphs (>60% word overlap)
 * 2. Hard cap at 500 chars (truncates cleanly at sentence boundary)
 * 3. Always sends as 1 single message (no splitting)
 * 4. Strips excessive emoji sequences
 */
async function cwSendWithTyping(cfg: BotCompanyConfig, conversationId: number, text: string) {
  const cleaned = cleanBotResponse(text)
  if (!cleaned) return
  await cwSendMessage(cfg, conversationId, cleaned)
}

function cleanBotResponse(text: string): string {
  // Step 1: Split into paragraphs
  let paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean)

  // Step 2: Remove duplicate/similar paragraphs
  // AI often repeats the same idea with different words. We use multiple strategies:
  const unique: string[] = []
  for (const p of paragraphs) {
    const isDuplicate = unique.some(existing =>
      wordSimilarity(existing, p) > 0.35 || // word overlap (cleaned of punctuation)
      phraseSimilarity(existing, p)          // key phrase detection
    )
    if (!isDuplicate) unique.push(p)
  }
  paragraphs = unique

  // Step 3: Hard cap at 3 paragraphs — forces conciseness
  if (paragraphs.length > 3) {
    paragraphs = paragraphs.slice(0, 3)
  }

  // Step 4: Join
  let result = paragraphs.join('\n\n')

  // Step 5: Strip excessive emojis (max 4 per message)
  let emojiCount = 0
  result = result.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, (match) => {
    emojiCount++
    return emojiCount <= 4 ? match : ''
  })

  return result.trim()
}

/** Normalize text for comparison: lowercase, strip punctuation, remove accents */
function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^\w\s]/g, ' ') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

/** Calculate word overlap ratio (0-1), with punctuation cleaned */
function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForCompare(a).split(' ').filter(w => w.length > 3))
  const wordsB = new Set(normalizeForCompare(b).split(' ').filter(w => w.length > 3))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  for (const w of wordsA) { if (wordsB.has(w)) overlap++ }
  return overlap / Math.min(wordsA.size, wordsB.size)
}

/** Detect semantically similar phrases even with different wording */
function phraseSimilarity(a: string, b: string): boolean {
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)

  // Key phrase groups — if both paragraphs contain phrases from same group, they're duplicates
  const PHRASE_GROUPS = [
    ['diagnostico', 'avaliacao', 'avaliar', 'tecnico', 'laboratorio'],
    ['coleta gratuita', 'buscar', 'retirada', 'coleta', 'bairro', 'cep'],
    ['nao vendemos', 'nao fazemos venda', 'nao vende', 'manutencao completa', 'pecas avulsas'],
    ['que chato', 'puxa', 'sinto muito', 'lamento'],
    ['sem compromisso', 'gratuito', 'gratis', 'orcamento gratuito'],
    ['transferir', 'atendente', 'humano', 'suporte'],
  ]

  for (const group of PHRASE_GROUPS) {
    const aHits = group.filter(phrase => na.includes(phrase)).length
    const bHits = group.filter(phrase => nb.includes(phrase)).length
    if (aHits >= 1 && bHits >= 1) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Dify API
// ---------------------------------------------------------------------------

interface DifyResponse {
  answer: string
  conversation_id: string
}

async function callDify(
  cfg: BotCompanyConfig,
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

  const res = await fetch(`${cfg.difyBaseUrl}/v1/chat-messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.difyApiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000), // 30s timeout — prevents lock from being held if Dify hangs
  })

  if (res.ok) {
    const data = await res.json()
    return {
      answer: data.answer || '',
      conversation_id: data.conversation_id || '',
    }
  }

  // If Dify says conversation doesn't exist in blocking mode, retry as new conversation
  if (res.status === 404 && conversationId) {
    const errBody = await res.text()
    if (errBody.includes('Conversation Not Exists')) {
      console.warn(`[Bot] Dify conversation ${conversationId} expired (blocking) — retrying as new conversation`)
      return callDify(cfg, query, user, undefined, imageUrls)
    }
  }

  console.warn(`[Bot] Dify blocking failed (${res.status}), trying streaming...`)

  const streamPayload = { ...payload, response_mode: 'streaming' }
  const streamRes = await fetch(`${cfg.difyBaseUrl}/v1/chat-messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.difyApiKey}`,
    },
    body: JSON.stringify(streamPayload),
    signal: AbortSignal.timeout(45000), // 45s timeout for streaming fallback
  })

  if (!streamRes.ok) {
    const errBody = await streamRes.text()
    // If Dify says conversation doesn't exist, retry without conversation_id (start fresh)
    if (streamRes.status === 404 && conversationId && errBody.includes('Conversation Not Exists')) {
      console.warn(`[Bot] Dify conversation ${conversationId} expired — retrying as new conversation`)
      return callDify(cfg, query, user, undefined, imageUrls)
    }
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
    // Block SSRF - only allow https URLs from known domains
    try {
      const parsed = new URL(audioUrl)
      if (parsed.protocol !== 'https:') {
        console.warn('[Bot] Blocked non-HTTPS audio URL')
        return ''
      }
      // Block internal IPs
      const hostname = parsed.hostname
      if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('172.') || hostname === '169.254.169.254' || hostname === '0.0.0.0' || hostname === '::1') {
        console.warn('[Bot] Blocked internal audio URL')
        return ''
      }
    } catch {
      return ''
    }

    // Download audio file
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      console.error(`[Bot] Failed to download audio: ${audioRes.status}`)
      return ''
    }

    const audioBuffer = await audioRes.arrayBuffer()

    const MAX_AUDIO_SIZE = 25 * 1024 * 1024 // 25MB
    if (audioBuffer.byteLength > MAX_AUDIO_SIZE) {
      console.warn('[Bot] Audio too large, skipping transcription')
      return ''
    }

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
  action: 'ABRIR_OS' | 'ENCERRAR_CONVERSA' | 'TRANSFERIR_HUMANO' | 'TRANSFERIR_RAFAEL' | 'NENHUMA_ACAO' | null
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
  } else if (text.includes('[TRANSFERIR_RAFAEL]')) {
    action = 'TRANSFERIR_RAFAEL'
    cleanText = cleanText.replace(/\[TRANSFERIR_RAFAEL\]/g, '').trim()
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

/** Release the debounce processing lock so the next batch can proceed */
async function releaseLock(botConvId: string) {
  await prisma.botConversation.update({
    where: { id: botConvId },
    data: { processing_lock: null },
  })
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // Multi-tenant: select company config by ?company= param (default: pontualtech)
  const companySlug = req.nextUrl.searchParams.get('company') || 'pontualtech'
  const cfg = await getCompanyConfig(companySlug)
  if (!cfg) {
    console.warn(`[Bot] Unknown company slug: ${companySlug}`)
    return NextResponse.json({ status: 'ignored', reason: 'unknown company' })
  }

  // Webhook authentication: require ?token= matching BOT_WEBHOOK_SECRET env var
  const webhookSecret = process.env.BOT_WEBHOOK_SECRET
  if (webhookSecret) {
    const token = req.nextUrl.searchParams.get('token')
    if (!token || token.length !== webhookSecret.length
      || !require('crypto').timingSafeEqual(Buffer.from(token), Buffer.from(webhookSecret))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process synchronously — cfg is passed through to avoid global mutation
  try {
    await processWebhook(cfg, body)
  } catch (err: any) {
    console.error('[Bot] Error:', err.message || err)
  }

  return NextResponse.json({ status: 'ok' })
}

export const maxDuration = 120 // 2 min timeout

// ---------------------------------------------------------------------------
// Async webhook processor (receives cfg to avoid module-level mutable state)
// ---------------------------------------------------------------------------

async function processWebhook(cfg: BotCompanyConfig, body: any) {
  const event = body.event

  // Handle conversation resolved — reset bot state BUT keep Dify memory
  if (event === 'conversation_status_changed') {
    const status = body.status || body.conversation?.status
    const convId = body.id || body.conversation?.id
    if (status === 'resolved' && convId) {
      await prisma.botConversation.updateMany({
        where: { chatwoot_conv_id: convId },
        data: {
          human_takeover: false,
          // KEEP dify_conv_id — preserves conversation memory in Dify
          step: 'IDLE',
          data: '{}',
          // CLEAR follow-up — resolved conversations should NOT receive follow-ups
          follow_up_next_at: null,
          follow_up_count: 0,
          follow_up_paused_at: null,
        },
      })
      console.log(`[Bot] Conversation ${convId} resolved — state reset (Dify memory preserved)`)
    }
    return
  }

  // Handle agent assignment — human takeover (skip if assigned to bot's own agent)
  if (event === 'conversation_updated') {
    const convId = body.id || body.conversation?.id
    const assignee = body.assignee || body.conversation?.meta?.assignee
    if (convId && assignee && assignee.id !== cfg.botAgentId) {
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

  // Outgoing messages: just return. Human takeover is handled ONLY via
  // conversation_updated (agent assignment) — not by detecting outgoing messages.
  // The outgoing detection was causing false positives because bot messages
  // sent via admin token appeared as human agent messages.
  if (isOutgoing) return

  // Only process incoming messages from customers
  const isIncoming = messageType === 'incoming' || messageType === 0
  if (!isIncoming) return

  // Ignore agent/bot outgoing messages
  if (senderType === 'user' || senderType === 'agent_bot' || senderType === 'User') return

  // Ignore private notes
  if (body.private) return

  // Filter by allowed inboxes
  const inboxId = body.inbox?.id || body.conversation?.inbox_id
  if (inboxId && !cfg.allowedInboxes.includes(inboxId)) {
    return
  }

  const conversationId: number = body.conversation?.id
  if (!conversationId) return

  const messageId = body.id?.toString() || ''

  // Extract content and handle audio
  let content = body.content?.trim() || ''

  // Process attachments: audio, images, video, documents
  const attachments = body.attachments || body.conversation?.messages?.[0]?.attachments || []
  const thisMessageImageUrls: string[] = []

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
      thisMessageImageUrls.push(url)
      content = `${content}\n[Imagem enviada pelo cliente]`.trim()
    } else if (fileType === 'video') {
      thisMessageImageUrls.push(url) // Gemini 2.5 Flash supports video via same files API
      content = `${content}\n[Video enviado pelo cliente - analise o conteudo]`.trim()
    } else if (fileType === 'file') {
      content = `${content}\n[Documento enviado: ${att.file_name || url}]`.trim()
    }
  }

  // Extract interactive button payload (when user clicks a reply button or list item)
  const interactiveReply = body.content_attributes?.interactive_reply
  const buttonPayload = interactiveReply?.id || interactiveReply?.button_id || ''

  if (!content && thisMessageImageUrls.length === 0 && !buttonPayload) return

  // Extract sender info
  const sender = body.sender || body.conversation?.meta?.sender || {}
  const phone = sender.phone_number || sender.phone || ''
  const contactId = sender.id || body.conversation?.contact_inbox?.contact?.id

  console.log(`[Bot] Message from ${phone || 'unknown'} in conv ${conversationId}: "${content.substring(0, 80)}"${buttonPayload ? ` [button: ${buttonPayload}]` : ''}`)

  // Find or create BotConversation (atomic upsert to prevent race conditions)
  const isNew = !(await prisma.botConversation.findUnique({ where: { chatwoot_conv_id: conversationId }, select: { id: true } }))
  let botConv = await prisma.botConversation.upsert({
    where: { chatwoot_conv_id: conversationId },
    update: {}, // don't overwrite existing data
    create: {
      company_id: cfg.companyId,
      chatwoot_conv_id: conversationId,
      chatwoot_contact_id: contactId || null,
      customer_phone: phone || null,
      inbox_id: inboxId || null,
      step: 'IDLE',
      data: {},
      message_history: [],
      pending_messages: [],
    },
  })

  if (isNew) {
    // Assign conversation to bot agent so messages show as bot's name
    fetch(`${cwBase(cfg)}/conversations/${conversationId}/assignments`, {
      method: 'POST',
      headers: cwHeaders(cfg),
      body: JSON.stringify({ assignee_id: cfg.botAgentId }),
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

  // -----------------------------------------------------------------------
  // INTERACTIVE BUTTONS: handle button clicks before debounce/Dify
  // -----------------------------------------------------------------------
  if (buttonPayload) {
    const handled = await handleButtonClick(cfg, botConv, conversationId, buttonPayload, phone, messageId)
    if (handled) return // Button was handled — skip Dify
  }

  // -----------------------------------------------------------------------
  // FOLLOW-UP: Check for opt-out keywords and reset follow-up timer
  // -----------------------------------------------------------------------
  const optOutDetected = await checkFollowUpOptOut(cfg.companyId, content)
  if (optOutDetected) {
    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: { follow_up_opted_out: true, follow_up_next_at: null },
    })
    console.log(`[Bot] Conv ${conversationId}: customer opted out of follow-ups`)
  }

  // -----------------------------------------------------------------------
  // DEBOUNCE: DB-based lock to consolidate rapid messages
  // -----------------------------------------------------------------------
  // Step 1: Save this message to pending_messages array (always, regardless of lock)
  // Also RESET follow-up timer — customer just replied, so cancel pending follow-up
  const pendingMsg = { content, imageUrls: thisMessageImageUrls, messageId, ts: Date.now() }
  // Append as array element: jsonb_array || jsonb_array = merged array
  await prisma.$executeRaw`
    UPDATE bot_conversations
    SET pending_messages = COALESCE(pending_messages, '[]'::jsonb) || ${JSON.stringify([pendingMsg])}::jsonb,
        last_message_id = ${messageId},
        customer_phone = COALESCE(${phone || null}, customer_phone),
        chatwoot_contact_id = COALESCE(${contactId || null}, chatwoot_contact_id),
        last_user_msg_at = NOW(),
        follow_up_count = 0,
        follow_up_next_at = NULL,
        follow_up_paused_at = NULL
    WHERE id = ${botConv.id}
  `

  // Step 2: Try to acquire the processing lock (atomic — only 1 request wins)
  const lockResult = await prisma.$executeRaw`
    UPDATE bot_conversations
    SET processing_lock = NOW()
    WHERE id = ${botConv.id}
      AND (processing_lock IS NULL OR processing_lock < NOW() - INTERVAL '15 seconds')
  `

  if (lockResult === 0) {
    // Another request already holds the lock — it will process our message
    console.log(`[Bot] Conv ${conversationId}: lock held by another request, message queued`)
    return
  }

  console.log(`[Bot] Conv ${conversationId}: lock acquired, waiting ${DEBOUNCE_WAIT_MS}ms for more messages...`)

  // Step 3: Wait for more messages to accumulate
  await new Promise(r => setTimeout(r, DEBOUNCE_WAIT_MS))

  // Step 4–7: Processing loop — keeps running until no more pending messages
  // Wrapped in try/finally to guarantee lock release even on unexpected errors
  const MAX_LOOPS = 3
  try {
  for (let loopIdx = 0; loopIdx < MAX_LOOPS; loopIdx++) {
    // Re-read bot conversation to get ALL pending messages
    botConv = await prisma.botConversation.findUnique({ where: { id: botConv.id } }) as any
    if (!botConv) return // botConv deleted — lock is gone with it

    // Re-check human takeover (might have been set during our wait)
    if (botConv.human_takeover) {
      await releaseLock(botConv.id)
      console.log(`[Bot] Conv ${conversationId}: human takeover activated during debounce, aborting`)
      return
    }

    // Read pending messages
    const pendingMsgs = (botConv.pending_messages || []) as Array<{ content: string; imageUrls?: string[]; messageId: string; ts: number }>
    if (pendingMsgs.length === 0) break // no more messages to process

    // Build consolidated query and collect all image URLs
    let query = pendingMsgs.map(m => m.content).join('\n')
    const imageUrls: string[] = pendingMsgs.flatMap(m => m.imageUrls || [])

    console.log(`[Bot] Conv ${conversationId}: loop ${loopIdx + 1} — processing ${pendingMsgs.length} consolidated message(s)`)

    // Clear pending messages and add to history
    const history = (botConv.message_history || []) as unknown as HistoryEntry[]
    const updatedHistory = addToHistory(history, 'user', query)

    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: {
        pending_messages: [],
        message_history: updatedHistory as any,
      },
    })

    // Auto-enrich: detect CEP or CNPJ in the consolidated query
    const cepMatch = query.match(/\b(\d{5})-?(\d{3})\b/)
    const cnpjMatch = query.match(/\b(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})\b/)

    if (cepMatch) {
      const cep = (cepMatch[1] + cepMatch[2]).replace(/\D/g, '')
      try {
        const cepRes = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(3000) })
        const cepData = await cepRes.json()
        if (!cepData.erro) {
          query += `\n[DADOS DO CEP ${cep}: ${cepData.logradouro || ''}, ${cepData.bairro || ''}, ${cepData.localidade || ''}-${cepData.uf || ''}]`
          console.log(`[Bot] CEP enriched: ${cep} → ${cepData.logradouro}, ${cepData.bairro}`)
        }
      } catch { /* ignore CEP lookup failure */ }
    }

    if (cnpjMatch) {
      const cnpj = query.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/)?.[0]?.replace(/\D/g, '') || ''
      if (cnpj.length === 14) {
        try {
          const cnpjRes = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
          })
          const cnpjData = await cnpjRes.json()
          if (cnpjData.nome) {
            query += `\n[DADOS DO CNPJ ${cnpj}: Razao Social: ${cnpjData.nome}, Fantasia: ${cnpjData.fantasia || 'N/A'}, Endereco: ${cnpjData.logradouro || ''} ${cnpjData.numero || ''}, ${cnpjData.bairro || ''}, ${cnpjData.municipio || ''}-${cnpjData.uf || ''}, CEP: ${cnpjData.cep || ''}, Tel: ${cnpjData.telefone || ''}, Email: ${cnpjData.email || ''}]`
            console.log(`[Bot] CNPJ enriched: ${cnpj} → ${cnpjData.nome}`)
          }
        } catch { /* ignore CNPJ lookup failure */ }
      }
    }

    // ── AUTO-ENRICH: inject OS data when message mentions an OS number (Marta suporte) ──
    if (cfg.slug === 'pontualtech-suporte' || cfg.botOrigin?.includes('marta')) {
      const osMatch = query.match(/(?:os|OS|O\.S\.?|ordem)\s*#?\s*(\d{4,6})/i) || query.match(/\b([56]\d{4})\b/)
      if (osMatch) {
        const osNum = parseInt(osMatch[1], 10)
        try {
          const osData = await prisma.serviceOrder.findFirst({
            where: { os_number: osNum, company_id: cfg.companyId, deleted_at: null },
            include: {
              customers: { select: { legal_name: true, email: true, mobile: true } },
              module_statuses: { select: { name: true, is_final: true } },
              user_profiles: { select: { name: true } },
            },
          })
          if (osData) {
            const status = osData.module_statuses?.name || 'Desconhecido'
            const equip = [osData.equipment_type, osData.equipment_brand, osData.equipment_model].filter(Boolean).join(' ')
            const previsao = osData.estimated_delivery ? new Date(osData.estimated_delivery).toLocaleDateString('pt-BR') : 'sem previsao'
            const isLegado = osData.created_at && osData.created_at < new Date('2026-04-10')

            // OS LEGADA (existe no ERP mas anterior a 10/04/2026) — transferir direto pro Rafael
            if (isLegado) {
              console.log(`[Bot] OS #${osNum} existe no ERP mas é legada (criada ${osData.created_at}) — transferência direta para Rafael`)
              const osNumFmt = String(osNum).padStart(5, '0')
              await cwSendMessage(cfg, conversationId,
                `Sua OS #${osNumFmt} é do nosso sistema anterior. Vou transferir agora para o Rafael, que cuida pessoalmente desses casos. Ele vai te retornar em breve!`)
              await cwSendMessage(cfg, conversationId,
                `[BOT] OS legada #${osNumFmt} (migrada, anterior a 10/04). Equip: ${equip}. Status: ${status}. Cliente: ${osData.customers?.legal_name || sender.name || 'N/I'}. Transferido automaticamente.`, true)
              const RAFAEL_AGENT_ID = 4
              try {
                await fetch(`${cwBase(cfg)}/conversations/${conversationId}/assignments`, {
                  method: 'POST',
                  headers: cwHeaders(cfg),
                  body: JSON.stringify({ assignee_id: RAFAEL_AGENT_ID }),
                })
              } catch {}
              await prisma.botConversation.update({
                where: { id: botConv.id },
                data: { human_takeover: true, step: 'HUMAN', follow_up_next_at: null },
              })
              await logBotMessage(cfg, conversationId, query, `OS legada #${osNumFmt} (migrada) — transferido para Rafael`, 'TRANSFERIR_RAFAEL', phone)
              await releaseLock(botConv.id)
              return
            }

            const portalUrl = `${process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'}/portal/pontualtech/os/${osData.id}`
            query += `\n[DADOS DA OS #${osNum}: Status: ${status}, Equipamento: ${equip}, Defeito: ${osData.reported_issue || 'N/A'}, Diagnostico: ${osData.diagnosis || 'N/A'}, Tecnico: ${osData.user_profiles?.name || 'N/A'}, Previsao: ${previsao}, Custo: ${osData.total_cost ? 'R$ ' + (osData.total_cost / 100).toFixed(2) : 'N/A'}, Cliente: ${osData.customers?.legal_name || 'N/A'}, Email: ${osData.customers?.email || 'N/A'}, Portal: ${portalUrl}]`
            console.log(`[Bot] OS enriched: #${osNum} → ${status} (${equip})`)
          } else if (osNum < 60000) {
            // OS LEGADA — transferir direto pro Rafael, sem passar pelo Dify
            console.log(`[Bot] OS #${osNum} é legado (VHSys) — transferência direta para Rafael`)
            const osNumFmt = String(osNum).padStart(5, '0')
            await cwSendMessage(cfg, conversationId,
              `Sua OS #${osNumFmt} é do nosso sistema anterior. Vou transferir agora para o Rafael, que cuida pessoalmente desses casos. Ele vai te retornar em breve!`)
            await cwSendMessage(cfg, conversationId,
              `[BOT] OS legada #${osNumFmt} (VHSys). Cliente: ${sender.name || phone || 'N/I'}. Transferido automaticamente.`, true)
            // Assign to Rafael (agent ID 4)
            const RAFAEL_AGENT_ID = 4
            try {
              await fetch(`${cwBase(cfg)}/conversations/${conversationId}/assignments`, {
                method: 'POST',
                headers: cwHeaders(cfg),
                body: JSON.stringify({ assignee_id: RAFAEL_AGENT_ID }),
              })
            } catch {} // fire and forget
            await prisma.botConversation.update({
              where: { id: botConv.id },
              data: { human_takeover: true, step: 'HUMAN', follow_up_next_at: null },
            })
            await logBotMessage(cfg, conversationId, query, `OS legada #${osNumFmt} — transferido para Rafael`, 'TRANSFERIR_RAFAEL', phone)
            await releaseLock(botConv.id)
            return // SAIR — não chamar Dify
          }
        } catch (e) { console.error('[Bot] OS enrich error:', e) }
      }

      // ── AUTO-IDENTIFY: find client by CPF/CNPJ in message, or by phone (with active OS priority) ──
      if (!osMatch) {
        try {
          const docMatch = query.match(/\b(\d{11})\b/) || query.match(/\b(\d{14})\b/) || query.match(/\b(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})\b/)
          let customer: any = null
          let activeOS: OsInfo[] = []

          // 1. Try CPF/CNPJ first (most specific)
          if (docMatch) {
            const cleanDoc = docMatch[0].replace(/\D/g, '')
            if (cleanDoc.length === 11 || cleanDoc.length === 14) {
              customer = await prisma.customer.findFirst({
                where: { company_id: cfg.companyId, deleted_at: null, document_number: { contains: cleanDoc } },
              })
              if (customer) {
                activeOS = await getActiveOrders(customer.id, cfg.companyId)
                console.log(`[Bot] Customer by doc ${cleanDoc}: ${customer.legal_name} (${activeOS.length} OS)`)
              }
            }
          }

          // 2. If no doc match or no OS found, try phone — but pick the customer WITH active OS
          if (!customer && phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10)
            if (cleanPhone.length >= 10) {
              const allMatches = await prisma.customer.findMany({
                where: {
                  company_id: cfg.companyId, deleted_at: null,
                  OR: [{ mobile: { contains: cleanPhone } }, { phone: { contains: cleanPhone } }],
                },
                take: 10,
              })
              // Pick the customer that has active OS (most relevant)
              for (const c of allMatches) {
                const os = await getActiveOrders(c.id, cfg.companyId)
                if (os.length > 0) {
                  customer = c
                  activeOS = os
                  console.log(`[Bot] Customer by phone (with OS): ${c.legal_name} (${os.length} OS)`)
                  break
                }
              }
              // If none has active OS, use first match
              if (!customer && allMatches.length > 0) {
                customer = allMatches[0]
                console.log(`[Bot] Customer by phone (no OS): ${customer.legal_name}`)
              }
            }
          }

          if (customer) {
            if (activeOS.length > 0) {
              // Check for legacy OS (all OS before 10/04/2026 would have been caught above,
              // but check by os_number < 60000 as safety net)
              const legacyOS = activeOS.filter(o => o.os_number < 60000)
              if (legacyOS.length > 0 && activeOS.length === legacyOS.length) {
                // ALL OS are legacy — transfer to Rafael
                console.log(`[Bot] Cliente ${customer.legal_name} tem ${legacyOS.length} OS legadas — transferência direta para Rafael`)
                await cwSendMessage(cfg, conversationId,
                  `Olá, ${customer.legal_name?.split(' ')[0] || 'tudo bem'}! Identifiquei seu cadastro. Suas ordens de serviço são do nosso sistema anterior. Vou transferir para o Rafael, que cuida pessoalmente desses casos!`)
                await cwSendMessage(cfg, conversationId,
                  `[BOT] Cliente ${customer.legal_name} (${phone}) — todas as ${legacyOS.length} OS são legadas. Transferido para Rafael.`, true)
                const RAFAEL_AGENT_ID = 4
                try {
                  await fetch(`${cwBase(cfg)}/conversations/${conversationId}/assignments`, {
                    method: 'POST', headers: cwHeaders(cfg),
                    body: JSON.stringify({ assignee_id: RAFAEL_AGENT_ID }),
                  })
                } catch {}
                await prisma.botConversation.update({
                  where: { id: botConv.id },
                  data: { human_takeover: true, step: 'HUMAN', follow_up_next_at: null },
                })
                await logBotMessage(cfg, conversationId, query, `Cliente legado — transferido para Rafael`, 'TRANSFERIR_RAFAEL', phone)
                await releaseLock(botConv.id)
                return
              }

              // Has active OS in new system — inject context with portal deep links
              const osList = activeOS.map(o => {
                const osNum = String(o.os_number).padStart(4, '0')
                const portalLink = o.os_id ? `https://portal.pontualtech.com.br/portal/pontualtech/os/${o.os_id}` : ''
                return `OS #${osNum} (${o.equipment}, Status: ${o.status_name}${portalLink ? `, Portal: ${portalLink}` : ''})`
              }).join('; ')
              query += `\n[CONTEXTO DO CLIENTE: Nome: ${customer.legal_name || 'N/A'}, Telefone: ${phone}, OS ativas: ${osList}. O cliente JA FOI IDENTIFICADO — NAO pergunte numero da OS, ja informe o status diretamente. SEMPRE inclua o link do portal na resposta.]`
              console.log(`[Bot] Auto-identified: ${customer.legal_name} — ${activeOS.length} active OS`)
            } else {
              // Customer found but no active OS — still inject name context
              query += `\n[CONTEXTO DO CLIENTE: Nome: ${customer.legal_name || 'N/A'}. NAO tem OS ativa no momento. Se o cliente informou CPF/CNPJ, confirme o nome e pergunte como pode ajudar.]`
              console.log(`[Bot] Customer found but no active OS: ${customer.legal_name}`)
            }
          }
        } catch (e) { console.error('[Bot] Auto-identify error:', e) }
      }
    }

    // ── MARTA RULES: inject behavioral constraints for suporte bot ──
    if (cfg.slug === 'pontualtech-suporte' || cfg.botOrigin?.includes('marta')) {
      query += `\n[REGRAS DA MARTA — OBRIGATORIO:
1. NUNCA prometa acoes (devolucao, agendamento, coleta, entrega, desconto, prazo). Voce APENAS INFORMA status e dados.
2. NUNCA diga "vou providenciar", "vou agendar", "vou devolver", "vou verificar com a equipe".
3. NUNCA invente valores, prazos ou informacoes. Use APENAS os dados fornecidos no contexto.
4. Respostas CURTAS (max 3 paragrafos). Sem excesso de emojis.
5. PORTAL DO CLIENTE: SEMPRE direcione o cliente para o portal. O portal permite aprovar orcamento, recusar orcamento, ver status, ver detalhes. O link do portal esta nos dados da OS.
6. APROVAR ou RECUSAR orcamento: informe que basta acessar o portal do cliente, clicar em aprovar ou recusar, e a notificacao eh enviada automaticamente para a equipe. NAO precisa de atendente para isso.
7. EVITAR TRANSFERENCIA: so use [TRANSFERIR_HUMANO] em ULTIMO CASO — quando o cliente ja tentou o portal e nao conseguiu, ou quando o problema nao pode ser resolvido pelo portal (ex: reclamacao grave, problema tecnico no site). Para tudo que o portal resolve (status, orcamento, aprovar, recusar), direcione ao portal.
8. Se o cliente insiste em falar com humano apos voce sugerir o portal, ai sim use [TRANSFERIR_HUMANO].]`
    }

    // Handle OS confirmation flow
    if (botConv.step === 'AWAITING_CONFIRMATION') {
      await handleOSConfirmation(cfg, botConv, query, conversationId)
      await releaseLock(botConv.id)
      return
    }

    // Call Dify
    try {
      const userIdentifier = phone || contactId?.toString() || `conv_${conversationId}`
      const difyResponse = await callDify(
        cfg,
        query,
        userIdentifier,
        botConv.dify_conv_id || undefined,
        imageUrls.length > 0 ? imageUrls : undefined
      )

      if (!difyResponse.answer) {
        // Retry once before giving up — Dify/Gemini sometimes returns empty on first try
        console.warn('[Bot] Empty Dify response — retrying once...')
        await new Promise(r => setTimeout(r, 1500))
        const retry = await callDify(cfg, query, userIdentifier, botConv.dify_conv_id || undefined, imageUrls.length > 0 ? imageUrls : undefined)
        if (retry.answer) {
          console.log('[Bot] Retry succeeded')
          Object.assign(difyResponse, retry)
        } else {
          console.error('[Bot] Retry also empty — fallback to support link')
          const supportUrl = `https://wa.me/${(cfg.supportWhatsApp || '').replace(/\D/g, '') || '551126263841'}`
          // Don't say anything to the client — only internal note for the agent
          await cwSendMessage(cfg, conversationId, `[BOT] ⚠️ Dify retornou vazio 2x para esta conversa. Atendente precisa assumir. Query: "${query.slice(0, 100)}"`, true)
          await prisma.botConversation.update({
            where: { id: botConv.id },
            data: { human_takeover: true, step: 'HUMAN' },
          })
          await releaseLock(botConv.id)
          return
        }
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
          headers: { 'Content-Type': 'application/json', 'X-Bot-Key': cfg.botApiKey },
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
            origem: cfg.botOrigin,
          }),
        })
        const erpData = await erpResp.json()
        const osNum = erpData.os_numero || 0
        const clienteNome = erpData.cliente_nome || parsed.vhsysData.nome || 'Cliente'
        if (osNum > 0) {
          await cwSendMessage(cfg, conversationId, `✅ *OS #${osNum}* aberta para ${clienteNome}!`)
          // Send professional template with button via Cloud API
          try {
            const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/cloud-api')
            const osEquip = [parsed.vhsysData?.marca, parsed.vhsysData?.modelo].filter(Boolean).join(' ') || parsed.vhsysData?.equipamento || 'Equipamento'
            const osDefect = parsed.vhsysData?.defeito || 'A diagnosticar'
            await sendWhatsAppTemplate(cfg.companyId, phone, 'pt_os_aberta_v2', 'pt_BR', [
              { type: 'body', parameters: [
                { type: 'text', text: String(osNum).padStart(4, '0') },
                { type: 'text', text: osEquip },
                { type: 'text', text: osDefect },
              ] }
            ])
          } catch {} // fire and forget
          // Private note with all links for agents (always visible in conversation)
          const vdNote = parsed.vhsysData as Record<string, any>
          const noteLines = [
            `📋 *OS #${osNum}* — ${clienteNome}${erpData.cliente_novo ? ' (NOVO)' : ''}`,
            `🖨️ ${String(vdNote.marca || '')} ${String(vdNote.modelo || '')} — ${String(vdNote.defeito || '')}`,
            `📄 CPF: ${String(vdNote.cpf_cnpj || 'N/I')} | 📞 ${String(vdNote.telefone || phone || 'N/I')}`,
            `📧 ${String(vdNote.email || 'N/I')} | 📍 ${String(vdNote.endereco || 'N/I')}`,
            ``,
            `🔗 ERP: ${ERP_BASE_URL}/os/${osNum}`,
            `🔗 Portal: ${cfg.portalUrl}`,
          ]
          await cwSendMessage(cfg, conversationId, noteLines.join('\n'), true)
          await cwSetLabels(cfg, conversationId, ['os_aberta'])

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
              portal_link: cfg.portalUrl,
              erp_cliente_id: String(erpData.cliente_id || ''),
            }
            try {
              const syncResp = await fetch(`${cwBase(cfg)}/contacts/${contactId}`, {
                method: 'PUT',
                headers: cwHeaders(cfg),
                body: JSON.stringify(contactUpdate),
              })
              if (!syncResp.ok) console.error('[Bot] Contact sync failed:', syncResp.status)
              else console.log('[Bot] Contact synced:', contactId)
            } catch (e) { console.error('[Bot] Contact sync error:', e) }

            // Also update conversation sidebar with OS info
            try {
              const convResp = await fetch(`${cwBase(cfg)}/conversations/${conversationId}/custom_attributes`, {
                method: 'PATCH',
                headers: cwHeaders(cfg),
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
                  headers: { 'Content-Type': 'application/json', 'X-Bot-Key': cfg.botApiKey },
                  body: JSON.stringify({
                    cliente_id: erpData.cliente_id,
                    chatwoot_contact_id: String(contactId),
                    chatwoot_url: `${cfg.cwUrl}/app/accounts/${cfg.cwAccountId}/conversations/${conversationId}`,
                  }),
                })
              } catch (e) { console.error('[Bot] ERP customer update error:', e) }
            }
          }
        } else {
          await cwSendMessage(cfg, conversationId, '[BOT] Erro ao criar OS: ' + (erpData.erro || 'desconhecido'), true)
        }
      } catch (erpErr) {
        console.error('[Bot] ERP abrir-os error:', erpErr)
        await cwSendMessage(cfg, conversationId, '[BOT] Excecao ao criar OS. Verificar logs.', true)
      }
      updateData.step = 'IDLE'
      updateData.data = {}
    } else if (parsed.action === 'TRANSFERIR_RAFAEL') {
      // Transfer to Rafael specifically (legacy OS handling)
      updateData.human_takeover = true
      updateData.step = 'HUMAN'
      await cwSendMessage(cfg, conversationId, '[BOT] OS do sistema legado — transferindo para Rafael.', true)
      // Assign conversation to Rafael (agent ID from Chatwoot)
      const RAFAEL_AGENT_ID = 4 // Rafael S in Chatwoot
      try {
        await fetch(`${cfg.cwUrl}/api/v1/accounts/${cfg.cwAccountId}/conversations/${conversationId}/assignments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', api_access_token: cfg.cwToken },
          body: JSON.stringify({ assignee_id: RAFAEL_AGENT_ID }),
        })
      } catch {} // fire and forget
    } else if (parsed.action === 'TRANSFERIR_HUMANO') {
      updateData.human_takeover = true
      updateData.step = 'HUMAN'
      // Assign to Rafael (agent 4) — NOT to Marta
      const RAFAEL_AGENT_ID = 4
      const now = new Date()
      const brHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours()
      const brDay = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()
      const isBusinessHours = brDay >= 1 && brDay <= 5 && brHour >= 8 && (brDay <= 4 ? brHour < 18 : brHour < 17)
      if (!isBusinessHours) {
        await cwSendMessage(cfg, conversationId, '[BOT] Fora do horário comercial. Atribuído ao Rafael para atender no próximo dia útil.', true)
      } else {
        await cwSendMessage(cfg, conversationId, '[BOT] Cliente solicitou atendente humano. Atribuído ao Rafael.', true)
      }
      try {
        await fetch(`${cwBase(cfg)}/conversations/${conversationId}/assignments`, {
          method: 'POST',
          headers: cwHeaders(cfg),
          body: JSON.stringify({ assignee_id: RAFAEL_AGENT_ID }),
        })
      } catch {}
    } else if (parsed.action === 'ENCERRAR_CONVERSA') {
      updateData.step = 'IDLE'
      updateData.data = {}
    }

    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: updateData,
    })

    // Send response to client — ensure wa.me links use the correct company support number
    if (parsed.cleanText) {
      const supportNum = (cfg.supportWhatsApp || '').replace(/\D/g, '') || '551126263841'
      let responseText = parsed.cleanText
        .replace(/https?:\/\/wa\.me\/\d+/gi, `https://wa.me/${supportNum}`)
      await cwSendWithTyping(cfg, conversationId, responseText)

      // ── POST-RESPONSE: send portal CTA when Dify mentions portal ──
      if (phone && !parsed.action && (cfg.slug === 'pontualtech-suporte' || cfg.botOrigin?.includes('marta'))) {
        try {
          const lowerResp = responseText.toLowerCase()
          if (lowerResp.includes('portal')) {
            // Extract specific portal URL from response, or use default
            const portalUrlMatch = responseText.match(/https?:\/\/portal\.pontualtech[^\s)>\]]+/)
            const portalUrl = portalUrlMatch?.[0] || cfg.portalUrl || 'https://portal.pontualtech.com.br/portal/pontualtech/login'
            await sendWhatsAppCtaUrl(cfg.companyId, phone, 'Acesse o portal para aprovar, recusar ou acompanhar sua OS:', '📱 Abrir Portal', portalUrl)
          }
        } catch (btnErr) {
          console.error('[Bot] Post-response CTA error:', btnErr)
        }
      }
    }

    // Post-send actions
    if (parsed.action === 'ENCERRAR_CONVERSA') {
      await new Promise(r => setTimeout(r, 2000))
      await cwResolve(cfg, conversationId)
    }

    // Schedule follow-up if conversation is still active (not ended, not transferred)
    if (!parsed.action || parsed.action === 'NENHUMA_ACAO') {
      await scheduleFollowUp(cfg.companyId, botConv.id)
    } else {
      // Conversation ended or transferred — clear any follow-up
      await prisma.botConversation.update({
        where: { id: botConv.id },
        data: { follow_up_next_at: null, follow_up_paused_at: null },
      })
    }

      // Log to chatbot_logs
      await logBotMessage(cfg, conversationId, query, parsed.cleanText, parsed.action || 'CHAT', phone)
    } catch (err) {
      console.error('[Bot] Dify call error:', err)
      // Don't say anything to the client — only internal note
      await cwSendMessage(cfg, conversationId, `[BOT] ⚠️ Erro ao chamar Dify AI. Atendente precisa assumir. Erro: ${err instanceof Error ? err.message : 'desconhecido'}`, true)
      break // don't retry on Dify errors
    }

    // Brief pause before checking for stragglers (give webhooks time to save)
    await new Promise(r => setTimeout(r, 500))
  } // end processing loop
  } finally {
    // ALWAYS release the lock — even on unexpected errors
    if (botConv?.id) await releaseLock(botConv.id)
  }
}

// ---------------------------------------------------------------------------
// OS Confirmation handler
// ---------------------------------------------------------------------------

async function handleOSConfirmation(
  cfg: BotCompanyConfig,
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
          'X-Bot-Key': cfg.botApiKey,
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
        await cwSendMessage(cfg,
          conversationId,
          `OS #${result.dados?.os_numero || result.data?.os_numero} criada com sucesso! Voce recebera atualizacoes sobre o andamento do servico.`
        )
        await cwSetLabels(cfg, conversationId, ['os_criada_bot'])
      } else {
        await cwSendMessage(cfg,
          conversationId,
          `Houve um erro ao criar a OS: ${result.erro || result.error || 'Erro desconhecido'}. Um atendente vai ajudar voce.`
        )
        await cwSendMessage(cfg, conversationId, `[BOT] Erro ao criar OS: ${JSON.stringify(result)}`, true)
      }
    } catch (err: any) {
      console.error('[Bot] OS creation error:', err)
      // Don't say anything to the client — only internal note
      await cwSendMessage(cfg, conversationId, `[BOT] ⚠️ Erro ao criar OS. Atendente precisa intervir. Erro: ${err.message}`, true)
    }

    // Reset state
    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: { step: 'IDLE', data: {} },
    })
  } else if (isReject) {
    await cwSendMessage(cfg, conversationId, 'Tudo bem, a abertura da OS foi cancelada. Se precisar de algo mais, e so me dizer!')
    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: { step: 'IDLE', data: {} },
    })
  } else {
    await cwSendMessage(cfg,
      conversationId,
      'Por favor, confirme: deseja abrir a OS? Responda *sim* para confirmar ou *nao* para cancelar.'
    )
  }
}

// ---------------------------------------------------------------------------
// Interactive Button Handlers
// ---------------------------------------------------------------------------

/**
 * Handle interactive button clicks (reply buttons and list selections).
 * Returns true if the button was handled — caller should skip Dify.
 */
async function handleButtonClick(
  cfg: BotCompanyConfig,
  botConv: any,
  conversationId: number,
  buttonPayload: string,
  phone: string,
  messageId: string
): Promise<boolean> {
  // Update last_message_id to prevent reprocessing
  await prisma.botConversation.update({
    where: { id: botConv.id },
    data: {
      last_message_id: messageId,
      last_user_msg_at: new Date(),
      follow_up_count: 0,
      follow_up_next_at: null,
      follow_up_paused_at: null,
    },
  })

  // ── Status: check specific OS ──
  if (buttonPayload === 'btn_status') {
    // Find customer's active OS
    const customer = phone ? await findCustomerByPhone(phone, cfg.companyId) : null
    if (!customer) {
      await cwSendMessage(cfg, conversationId, 'Para consultar o status, me informe o número da sua OS.')
      return true
    }
    const activeOS = await getActiveOrders(customer.id, cfg.companyId)
    if (activeOS.length === 0) {
      await cwSendMessage(cfg, conversationId, 'Não encontrei nenhuma OS ativa no seu nome. Poderia informar o número?')
    } else if (activeOS.length === 1) {
      await sendOsStatusButtons(cfg, conversationId, phone, activeOS[0])
    } else {
      await sendOsListSelector(cfg, conversationId, phone, activeOS)
    }
    await logBotMessage(cfg, conversationId, '[BUTTON] btn_status', 'Interactive OS status', 'BUTTON_STATUS', phone)
    return true
  }

  // ── Orçamento ──
  if (buttonPayload === 'btn_orcamento') {
    const customer = phone ? await findCustomerByPhone(phone, cfg.companyId) : null
    if (!customer) {
      await cwSendMessage(cfg, conversationId, 'Para ver o orçamento, me informe o número da sua OS.')
      return true
    }
    const activeOS = await getActiveOrders(customer.id, cfg.companyId)
    if (activeOS.length === 0) {
      await cwSendMessage(cfg, conversationId, 'Não encontrei OS ativa no seu nome.')
    } else if (activeOS.length === 1) {
      await sendOrcamentoButtons(cfg, conversationId, phone, activeOS[0])
    } else {
      await sendOsListSelector(cfg, conversationId, phone, activeOS)
    }
    await logBotMessage(cfg, conversationId, '[BUTTON] btn_orcamento', 'Interactive orcamento', 'BUTTON_ORCAMENTO', phone)
    return true
  }

  // ── Falar com humano (mantido como fallback caso botão antigo ainda circule) ──
  if (buttonPayload === 'btn_humano') {
    const now = new Date()
    const brHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours()
    const brDay = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()
    const isBusinessHours = brDay >= 1 && brDay <= 5 && brHour >= 8 && (brDay <= 4 ? brHour < 18 : brHour < 17)

    if (isBusinessHours) {
      await cwSendMessage(cfg, conversationId, 'Entendi! Vou transferir para um atendente. Um momento...')
    } else {
      await cwSendMessage(cfg, conversationId, 'Nosso atendimento humano funciona de seg a qui das 8h às 18h e sexta das 8h às 17h. Registrei sua solicitação e um atendente vai te retornar no próximo horário comercial!')
    }
    await cwSendMessage(cfg, conversationId, '[BOT] Cliente solicitou atendente humano. Atribuído ao Rafael.', true)
    // Assign to Rafael (agent 4)
    const RAFAEL_AGENT_ID_BTN = 4
    try {
      await fetch(`${cwBase(cfg)}/conversations/${conversationId}/assignments`, {
        method: 'POST',
        headers: cwHeaders(cfg),
        body: JSON.stringify({ assignee_id: RAFAEL_AGENT_ID_BTN }),
      })
    } catch {}
    await prisma.botConversation.update({
      where: { id: botConv.id },
      data: { human_takeover: true, step: 'HUMAN' },
    })
    await logBotMessage(cfg, conversationId, '[BUTTON] btn_humano', 'Transferir humano → Rafael', 'BUTTON_HUMANO', phone)
    return true
  }

  // ── OS Selection from list ──
  if (buttonPayload.startsWith('os_')) {
    const osNum = parseInt(buttonPayload.replace('os_', ''), 10)
    if (!isNaN(osNum)) {
      const os = await prisma.serviceOrder.findFirst({
        where: { os_number: osNum, company_id: cfg.companyId, deleted_at: null },
        include: {
          module_statuses: true,
          customers: { select: { legal_name: true, email: true } },
          user_profiles: { select: { name: true } },
          service_order_items: { where: { deleted_at: null }, select: { id: true } },
        },
      })
      if (os) {
        await sendOsStatusButtons(cfg, conversationId, phone, {
          os_number: os.os_number,
          status_name: os.module_statuses?.name || 'Desconhecido',
          equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
          estimated_delivery: os.estimated_delivery,
          total_cost: os.total_cost,
          os_id: os.id,
          has_items: (os.service_order_items?.length || 0) > 0,
        })
      } else {
        await cwSendMessage(cfg, conversationId, `Não encontrei a OS-${String(osNum).padStart(4, '0')}. Verifique o número.`)
      }
      await logBotMessage(cfg, conversationId, `[BUTTON] os_${osNum}`, 'OS selected from list', 'BUTTON_OS_SELECT', phone)
      return true
    }
  }

  // ── Aprovar orçamento ──
  if (buttonPayload.startsWith('approve_')) {
    const osNum = parseInt(buttonPayload.replace('approve_', ''), 10)
    if (!isNaN(osNum)) {
      await handleBotApproval(cfg, conversationId, phone, osNum, true)
      await logBotMessage(cfg, conversationId, `[BUTTON] approve_${osNum}`, 'Orcamento aprovado via botao', 'BUTTON_APPROVE', phone)
      return true
    }
  }

  // ── Recusar orçamento ──
  if (buttonPayload.startsWith('reject_')) {
    const osNum = parseInt(buttonPayload.replace('reject_', ''), 10)
    if (!isNaN(osNum)) {
      await handleBotApproval(cfg, conversationId, phone, osNum, false)
      await logBotMessage(cfg, conversationId, `[BUTTON] reject_${osNum}`, 'Orcamento recusado via botao', 'BUTTON_REJECT', phone)
      return true
    }
  }

  // ── Portal link ──
  if (buttonPayload === 'btn_portal') {
    const portalUrl = cfg.portalUrl || `${ERP_BASE_URL}/portal/pontualtech/login`
    await sendWhatsAppCtaUrl(cfg.companyId, phone,
      'Acesse o portal para ver todos os detalhes da sua OS, aprovar orçamentos e acompanhar o status:',
      '🔗 Abrir Portal', portalUrl, 'Portal PontualTech')
    await logBotMessage(cfg, conversationId, '[BUTTON] btn_portal', 'Portal link sent', 'BUTTON_PORTAL', phone)
    return true
  }

  return false // Unknown button — let Dify handle it
}

// ---------------------------------------------------------------------------
// Interactive Message Senders (via Meta Cloud API)
// ---------------------------------------------------------------------------

interface OsInfo {
  os_number: number
  status_name: string
  equipment: string
  estimated_delivery?: Date | null
  total_cost?: number | null
  os_id?: string
  has_items?: boolean
}

/** Send OS status with action buttons */
async function sendOsStatusButtons(cfg: BotCompanyConfig, conversationId: number, phone: string, os: OsInfo) {
  const osNum = String(os.os_number).padStart(4, '0')
  const previsao = os.estimated_delivery
    ? `\n📅 Previsão: ${new Date(os.estimated_delivery).toLocaleDateString('pt-BR')}`
    : ''
  const body = `*OS-${osNum}*\n🖨️ ${os.equipment}\n📊 Status: *${os.status_name}*${previsao}`

  // Also send as Chatwoot message so agents can see it
  await cwSendMessage(cfg, conversationId, body)

  // Send interactive buttons via Meta API
  const buttons: ReplyButton[] = []
  if (os.has_items) {
    buttons.push({ id: `btn_orcamento`, title: '💰 Ver orçamento' })
  }
  buttons.push({ id: 'btn_portal', title: '📱 Abrir portal' })

  await sendWhatsAppButtons(cfg.companyId, phone, 'O que deseja fazer?', buttons.slice(0, 3),
    `Status OS-${osNum}`, 'PontualTech Suporte')

  // Check for severe delays
  if (os.estimated_delivery) {
    const daysOverdue = Math.floor((Date.now() - new Date(os.estimated_delivery).getTime()) / (1000 * 60 * 60 * 24))
    if (daysOverdue > 3) {
      await cwSendMessage(cfg, conversationId, `⚠️ Peço desculpas pelo atraso na OS-${osNum}. Vou escalar para nosso supervisor.`)
    }
  }
}

/** Send OS list when customer has multiple active orders */
async function sendOsListSelector(cfg: BotCompanyConfig, conversationId: number, phone: string, orders: OsInfo[]) {
  const rows: ListRow[] = orders.slice(0, 10).map(os => ({
    id: `os_${os.os_number}`,
    title: `OS-${String(os.os_number).padStart(4, '0')}`,
    description: `${os.equipment} — ${os.status_name}`.slice(0, 72),
  }))

  await sendWhatsAppList(cfg.companyId, phone,
    `Encontrei ${orders.length} OS no seu nome. Qual deseja consultar?`,
    'Ver minhas OS',
    [{ title: 'Ordens de Serviço', rows }],
    'PontualTech Suporte')

  // Also log in Chatwoot
  const list = orders.map(os => `• OS-${String(os.os_number).padStart(4, '0')} — ${os.equipment} (${os.status_name})`).join('\n')
  await cwSendMessage(cfg, conversationId, `[BOT] Cliente tem ${orders.length} OS ativas. Enviada lista interativa:\n${list}`, true)
}

/** Send orçamento with approve/reject buttons */
async function sendOrcamentoButtons(cfg: BotCompanyConfig, conversationId: number, phone: string, os: OsInfo) {
  const osNum = String(os.os_number).padStart(4, '0')

  if (!os.has_items) {
    await cwSendMessage(cfg, conversationId, `A OS-${osNum} ainda está em análise técnica. Assim que o diagnóstico for concluído, enviaremos o orçamento.`)
    return
  }

  const totalFormatted = os.total_cost
    ? (os.total_cost / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : 'A consultar'

  // Chatwoot message (agents see)
  await cwSendMessage(cfg, conversationId, `*Orçamento OS-${osNum}*\n💰 Valor: *${totalFormatted}*`)

  // Interactive approve/reject buttons via Meta API
  await sendWhatsAppButtons(cfg.companyId, phone,
    `*Orçamento OS-${osNum}*\n\n💰 Valor total: *${totalFormatted}*\n\nO detalhamento está no portal. Deseja aprovar?`,
    [
      { id: `approve_${os.os_number}`, title: '✅ Aprovar' },
      { id: `reject_${os.os_number}`, title: '❌ Recusar' },
    ],
    'Orçamento PontualTech')

  // Portal CTA button
  const portalUrl = cfg.portalUrl || `${ERP_BASE_URL}/portal/pontualtech/login`
  await sendWhatsAppCtaUrl(cfg.companyId, phone,
    'Veja o detalhamento completo e aprove pelo portal:',
    '📄 Ver orçamento', portalUrl)
}

/** Handle orçamento approval/rejection via button */
async function handleBotApproval(cfg: BotCompanyConfig, conversationId: number, phone: string, osNumber: number, approved: boolean) {
  const osNum = String(osNumber).padStart(4, '0')

  const os = await prisma.serviceOrder.findFirst({
    where: { os_number: osNumber, company_id: cfg.companyId, deleted_at: null },
    include: { module_statuses: true },
  })

  if (!os) {
    await cwSendMessage(cfg, conversationId, `Não encontrei a OS-${osNum}. Verifique o número.`)
    return
  }

  if (!os.module_statuses?.name?.toLowerCase().includes('aguardando')) {
    await cwSendMessage(cfg, conversationId, `A OS-${osNum} não está aguardando aprovação. Status atual: ${os.module_statuses?.name}`)
    return
  }

  if (approved) {
    const approvedStatus = await prisma.moduleStatus.findFirst({
      where: {
        company_id: cfg.companyId,
        module: 'os',
        name: { in: ['Aprovada', 'Aprovado', 'Em Execução', 'Em Andamento'] },
      },
      orderBy: { order: 'asc' },
    })

    if (approvedStatus) {
      await prisma.$transaction([
        prisma.serviceOrder.update({
          where: { id: os.id },
          data: { status_id: approvedStatus.id },
        }),
        prisma.serviceOrderHistory.create({
          data: {
            company_id: cfg.companyId,
            service_order_id: os.id,
            from_status_id: os.status_id,
            to_status_id: approvedStatus.id,
            changed_by: 'bot-marta-button',
            notes: 'Orçamento aprovado pelo cliente via botão WhatsApp',
          },
        }),
      ])

      await cwSendMessage(cfg, conversationId, `✅ Orçamento da OS-${osNum} aprovado com sucesso!`)
      await sendWhatsAppButtons(cfg.companyId, phone,
        `✅ *Orçamento aprovado!*\n\nNossa equipe já vai iniciar o serviço na OS-${osNum}. Você receberá uma notificação quando estiver pronto.`,
        [
          { id: 'btn_status', title: '📋 Ver status' },
          { id: 'btn_portal', title: '📱 Abrir portal' },
        ],
        'Aprovado!')
      await cwSendMessage(cfg, conversationId, `[BOT] ✅ OS-${osNum} aprovada via botão WhatsApp`, true)
      await cwSetLabels(cfg, conversationId, ['orcamento_aprovado'])
    }
  } else {
    await cwSendMessage(cfg, conversationId, `Entendi. Registrei que você não deseja prosseguir com a OS-${osNum}. Um atendente entrará em contato no próximo horário comercial (seg-qui 8h-18h, sex 8h-17h) para combinar a retirada do equipamento.`)
    await cwSendMessage(cfg, conversationId, `[BOT] ❌ OS-${osNum} recusada via botão WhatsApp — cliente precisa agendar retirada`, true)
  }
}

// ---------------------------------------------------------------------------
// Database Helpers for Interactive Buttons
// ---------------------------------------------------------------------------

async function findCustomerByPhone(phone: string, companyId: string) {
  const cleanPhone = phone.replace(/\D/g, '').slice(-10)
  if (cleanPhone.length < 10) return null
  return prisma.customer.findFirst({
    where: {
      company_id: companyId,
      deleted_at: null,
      OR: [
        { mobile: { contains: cleanPhone } },
        { phone: { contains: cleanPhone } },
      ],
    },
  })
}

async function getActiveOrders(customerId: string, companyId: string): Promise<OsInfo[]> {
  const orders = await prisma.serviceOrder.findMany({
    where: {
      customer_id: customerId,
      company_id: companyId,
      deleted_at: null,
      module_statuses: { is_final: false },
    },
    include: {
      module_statuses: true,
      service_order_items: { where: { deleted_at: null }, select: { id: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 10,
  })

  return orders.map(os => ({
    os_number: os.os_number,
    status_name: os.module_statuses?.name || 'Desconhecido',
    equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
    estimated_delivery: os.estimated_delivery,
    total_cost: os.total_cost,
    os_id: os.id,
    has_items: (os.service_order_items?.length || 0) > 0,
  }))
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

async function logBotMessage(
  cfg: BotCompanyConfig,
  conversationId: number,
  userMessage: string,
  botResponse: string,
  action: string,
  phone?: string
) {
  try {
    await prisma.chatbotLog.create({
      data: {
        company_id: cfg.companyId,
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

// ---------------------------------------------------------------------------
// Follow-up helpers
// ---------------------------------------------------------------------------

/** Default follow-up settings (same as cron route) */
const FOLLOWUP_DEFAULTS: Record<string, string> = {
  'bot.followup.enabled': 'true',
  'bot.followup.interval_1_minutes': '60',
  'bot.followup.opt_out_keywords': 'parar,cancelar,nao quero,sair,stop,pare,nao me mande,nao envie',
}

/** Cache follow-up settings per company (refreshed every 5 min, max 50 entries) */
const followUpSettingsCache = new Map<string, { data: Record<string, string>; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000
const CACHE_MAX = 50

async function getFollowUpSettings(companyId: string): Promise<Record<string, string>> {
  const cached = followUpSettingsCache.get(companyId)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data
  // Evict oldest entries if cache is too large
  if (followUpSettingsCache.size >= CACHE_MAX) followUpSettingsCache.clear()

  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'bot.followup.' } },
  })
  const cfg = { ...FOLLOWUP_DEFAULTS }
  for (const s of settings) cfg[s.key] = s.value
  followUpSettingsCache.set(companyId, { data: cfg, ts: Date.now() })
  return cfg
}

/** Check if customer message contains opt-out keywords */
async function checkFollowUpOptOut(companyId: string, content: string): Promise<boolean> {
  const cfg = await getFollowUpSettings(companyId)
  const keywords = (cfg['bot.followup.opt_out_keywords'] || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
  const normalized = content.toLowerCase().trim()
  // Only trigger opt-out if message is short (< 50 chars) or the keyword is the entire message
  // This prevents false positives like "quero parar de ter problema com minha impressora"
  if (normalized.length > 50) return false
  return keywords.some(kw => normalized.includes(kw))
}

/** Schedule the first follow-up after bot responds */
async function scheduleFollowUp(companyId: string, botConvId: string) {
  try {
    const cfg = await getFollowUpSettings(companyId)
    if (cfg['bot.followup.enabled'] !== 'true') return

    const intervalMinutes = parseInt(cfg['bot.followup.interval_1_minutes'] || '60')
    const nextAt = new Date(Date.now() + intervalMinutes * 60 * 1000)

    await prisma.botConversation.update({
      where: { id: botConvId },
      data: {
        follow_up_next_at: nextAt,
        follow_up_paused_at: new Date(),
      },
    })
  } catch (err) {
    console.error('[Bot] Failed to schedule follow-up:', err)
  }
}
