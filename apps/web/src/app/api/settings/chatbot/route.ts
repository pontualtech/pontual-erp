import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import crypto from 'crypto'

// Chaves chatbot.* no banco
const CHATBOT_KEYS = [
  'chatbot.enabled',
  'chatbot.provider',
  'chatbot.api_key',
  'chatbot.model',
  'chatbot.system_prompt',
  'chatbot.resp_saudacao',
  'chatbot.resp_cliente_nao_identificado',
  'chatbot.resp_sem_os',
  'chatbot.resp_transferencia',
  'chatbot.resp_erro',
]

// Campos do form -> chaves no banco
const FIELD_MAP: Record<string, string> = {
  enabled: 'chatbot.enabled',
  provider: 'chatbot.provider',
  api_key: 'chatbot.api_key',
  model: 'chatbot.model',
  system_prompt: 'chatbot.system_prompt',
  resp_saudacao: 'chatbot.resp_saudacao',
  resp_cliente_nao_identificado: 'chatbot.resp_cliente_nao_identificado',
  resp_sem_os: 'chatbot.resp_sem_os',
  resp_transferencia: 'chatbot.resp_transferencia',
  resp_erro: 'chatbot.resp_erro',
}

const KEY_MAP = Object.fromEntries(Object.entries(FIELD_MAP).map(([k, v]) => [v, k]))

// Simple encryption for API key storage
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || ''

function encrypt(text: string): string {
  if (!text) return ''
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

function decrypt(text: string): string {
  if (!text || !text.includes(':')) return ''
  try {
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32)
    const [ivHex, encrypted] = text.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    return ''
  }
}

function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

/**
 * GET /api/settings/chatbot — Carregar configuracoes do chatbot
 */
export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { in: CHATBOT_KEYS } },
    })

    const data: Record<string, string> = {}
    for (const s of settings) {
      const field = KEY_MAP[s.key]
      if (!field) continue
      if (field === 'api_key') {
        // Return masked key
        const decrypted = decrypt(s.value)
        data[field] = decrypted ? maskApiKey(decrypted) : ''
        data.api_key_configured = decrypted ? 'true' : 'false'
      } else {
        data[field] = s.value
      }
    }

    // Stats: conversas de hoje
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [totalHoje, resolvidasBot, transferidas] = await Promise.all([
      prisma.chatbotLog.count({
        where: { company_id: user.companyId, created_at: { gte: todayStart } },
      }),
      prisma.chatbotLog.count({
        where: { company_id: user.companyId, created_at: { gte: todayStart }, status: 'bot' },
      }),
      prisma.chatbotLog.count({
        where: { company_id: user.companyId, created_at: { gte: todayStart }, status: 'transferred' },
      }),
    ])

    data.stats_total_hoje = String(totalHoje)
    data.stats_resolvidas_bot = String(resolvidasBot)
    data.stats_transferidas = String(transferidas)

    return success(data)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * PUT /api/settings/chatbot — Salvar configuracoes do chatbot
 */
export async function PUT(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    for (const [field, settingKey] of Object.entries(FIELD_MAP)) {
      let value = body[field]
      if (value === undefined || value === null) continue

      // Encrypt API key before saving
      if (field === 'api_key') {
        // Skip if masked value (unchanged)
        if (String(value).includes('****')) continue
        value = encrypt(String(value))
      }

      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key: settingKey } },
        create: { company_id: user.companyId, key: settingKey, value: String(value), type: 'string' },
        update: { value: String(value) },
      })
    }

    return success({ saved: true })
  } catch (err) {
    return handleError(err)
  }
}
