import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireInternalKey } from '@/lib/internal-auth'
import { invalidateWhatsAppCloudConfigCache } from '@/lib/whatsapp/cloud-api'

/**
 * POST /api/internal/whatsapp/configure-channel
 *
 * Configura o phone_number_id + access_token de UM canal especifico
 * (suporte ou vendas) pra uma empresa. Permite a separacao entre
 * relacionamento (notif de OS/ticket/cobranca) e marketing/vendas.
 *
 * Body:
 *   { company_id, channel: 'suporte'|'vendas',
 *     phone_number_id?, access_token? }
 *
 * Settings escritas:
 *   whatsapp.cloud.{channel}.phone_number_id
 *   whatsapp.cloud.{channel}.access_token  (se fornecido)
 *
 * Auth: x-internal-key = CRON_SECRET
 */
export async function POST(req: NextRequest) {
  const guard = requireInternalKey(req); if (guard) return guard

  const body = await req.json().catch(() => ({}))
  const { company_id, channel, phone_number_id, access_token } = body
  if (!company_id) return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })
  if (channel !== 'suporte' && channel !== 'vendas') {
    return NextResponse.json({ error: 'channel deve ser "suporte" ou "vendas"' }, { status: 400 })
  }
  if (!phone_number_id && !access_token) {
    return NextResponse.json({ error: 'forneca phone_number_id ou access_token (ou ambos)' }, { status: 400 })
  }

  const updates: { key: string; value: string }[] = []
  if (phone_number_id) {
    updates.push({ key: `whatsapp.cloud.${channel}.phone_number_id`, value: String(phone_number_id) })
  }
  if (access_token) {
    updates.push({ key: `whatsapp.cloud.${channel}.access_token`, value: String(access_token) })
  }

  for (const u of updates) {
    await prisma.setting.upsert({
      where: { company_id_key: { company_id, key: u.key } },
      create: { company_id, key: u.key, value: u.value, type: 'string' },
      update: { value: u.value },
    })
  }

  invalidateWhatsAppCloudConfigCache(company_id)

  // Confirma com a Meta que o phone_number_id existe e retorna metadata
  let phoneInfo: any = null
  if (phone_number_id && access_token) {
    try {
      const phRes = await fetch(`https://graph.facebook.com/v21.0/${phone_number_id}?fields=display_phone_number,verified_name,quality_rating,status,messaging_limit_tier`, {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      phoneInfo = await phRes.json()
    } catch (e: any) {
      phoneInfo = { error: e.message }
    }
  }

  return NextResponse.json({
    ok: true,
    company_id,
    channel,
    updated_keys: updates.map(u => u.key),
    phone_info: phoneInfo,
  })
}

/**
 * GET /api/internal/whatsapp/configure-channel?company_id=X
 *
 * Retorna a config atual de ambos canais (mascarando o access_token).
 * Inclui tambem as chaves legacy (sem prefixo de canal) pra debug.
 */
export async function GET(req: NextRequest) {
  const guard = requireInternalKey(req); if (guard) return guard

  const company_id = req.nextUrl.searchParams.get('company_id')
  if (!company_id) return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
    orderBy: { key: 'asc' },
  })

  const mask = (v: string) => v.length > 12 ? `${v.slice(0, 6)}...${v.slice(-4)}` : '***'
  const data: Record<string, string> = {}
  for (const s of settings) {
    data[s.key] = s.key.includes('access_token') ? mask(s.value) : s.value
  }

  return NextResponse.json({ company_id, settings: data })
}
