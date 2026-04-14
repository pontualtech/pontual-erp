import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

// All follow-up setting keys
const FOLLOWUP_KEYS = [
  'bot.followup.enabled',
  'bot.followup.max_attempts',
  'bot.followup.interval_1_minutes',
  'bot.followup.interval_2_minutes',
  'bot.followup.interval_3_minutes',
  'bot.followup.msg_1',
  'bot.followup.msg_2',
  'bot.followup.msg_3',
  'bot.followup.business_hours_only',
  'bot.followup.business_hour_start',
  'bot.followup.business_hour_end',
  'bot.followup.business_days', // "1,2,3,4,5" = seg-sex
  'bot.followup.opt_out_keywords',
]

// Defaults
const DEFAULTS: Record<string, string> = {
  'bot.followup.enabled': 'true',
  'bot.followup.max_attempts': '3',
  'bot.followup.interval_1_minutes': '60',       // 1h after silence
  'bot.followup.interval_2_minutes': '1440',      // 24h after silence
  'bot.followup.interval_3_minutes': '4320',      // 72h after silence
  'bot.followup.msg_1': 'Oi! 😊 Vi que voce nao respondeu. Posso te ajudar com algo? Estou aqui para o que precisar!',
  'bot.followup.msg_2': 'Ola! Passando para saber se ainda precisa de ajuda. Se tiver qualquer duvida sobre nossos servicos, e so me chamar! 🔧',
  'bot.followup.msg_3': 'Oi! Essa e minha ultima mensagem para nao te incomodar. Se precisar de assistencia tecnica no futuro, estamos a disposicao! Ate mais! 👋',
  'bot.followup.business_hours_only': 'true',
  'bot.followup.business_hour_start': '8',
  'bot.followup.business_hour_end': '18',
  'bot.followup.business_days': '1,2,3,4,5',
  'bot.followup.opt_out_keywords': 'parar,cancelar,nao quero,sair,stop,pare,nao me mande,nao envie',
}

/**
 * GET /api/settings/bot-followup — Load follow-up config
 */
export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { in: FOLLOWUP_KEYS } },
    })

    const data: Record<string, string> = { ...DEFAULTS }
    for (const s of settings) {
      data[s.key] = s.value
    }

    return success(data)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * PUT /api/settings/bot-followup — Save follow-up config
 */
export async function PUT(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    for (const key of FOLLOWUP_KEYS) {
      const value = body[key]
      if (value === undefined || value === null) continue

      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key } },
        create: { company_id: user.companyId, key, value: String(value), type: 'string' },
        update: { value: String(value) },
      })
    }

    return success({ saved: true })
  } catch (err) {
    return handleError(err)
  }
}
