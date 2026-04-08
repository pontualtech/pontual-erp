import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

const BOT_KEY = process.env.BOT_ANA_API_KEY || ''
const COMPANY_ID = process.env.BOT_ANA_COMPANY_ID || 'pontualtech-001'

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
  const key = req.headers.get('x-bot-key')
    || req.nextUrl.searchParams.get('key')
    || ''

  if (!BOT_KEY) {
    return NextResponse.json({ ok: false, erro: 'Bot API key nao configurada no servidor' }, { status: 500 })
  }

  if (!safeEqual(key, BOT_KEY)) {
    return NextResponse.json({ ok: false, erro: 'Chave de API invalida' }, { status: 401 })
  }

  return { companyId: COMPANY_ID }
}
