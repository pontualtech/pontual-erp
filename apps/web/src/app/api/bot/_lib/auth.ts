import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

interface BotKeyEntry {
  key: string
  companyId: string
}

// Build list of bot API keys from env vars (multi-tenant support)
// Each company has BOT_{PREFIX}_API_KEY and BOT_{PREFIX}_COMPANY_ID
function loadBotKeys(): BotKeyEntry[] {
  const keys: BotKeyEntry[] = []
  const seen = new Set<string>()
  for (const [name, value] of Object.entries(process.env)) {
    const match = name.match(/^BOT_(.+)_API_KEY$/)
    if (match && value) {
      const prefix = match[1]
      if (seen.has(prefix)) continue
      seen.add(prefix)
      const companyId = process.env[`BOT_${prefix}_COMPANY_ID`] || ''
      if (companyId) {
        keys.push({ key: value, companyId })
      }
    }
  }
  return keys
}

const BOT_KEYS = loadBotKeys()

export interface BotContext {
  companyId: string
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

export function authenticateBot(req: NextRequest): BotContext | NextResponse {
  const key = req.headers.get('x-bot-key') || ''

  if (BOT_KEYS.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Bot API key nao configurada no servidor' }, { status: 500 })
  }

  for (const entry of BOT_KEYS) {
    if (safeEqual(key, entry.key)) {
      return { companyId: entry.companyId }
    }
  }

  return NextResponse.json({ ok: false, erro: 'Chave de API invalida' }, { status: 401 })
}
