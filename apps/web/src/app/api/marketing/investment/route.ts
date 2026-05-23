import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

/**
 * GET/POST /api/marketing/investment
 *
 * Sprint UX-16 (2026-05-23) — Investimento manual por canal pra calcular CAC.
 * Settings: `marketing.investment.{channel}` em centavos por mês.
 *
 * GET: retorna investments atuais (todos canais).
 * POST: { channel, amount_cents } — upsert do setting.
 */

const ALLOWED_CHANNELS = [
  'google_ads', 'google_organic', 'meta_ads', 'meta_organic',
  'whatsapp', 'instagram', 'youtube', 'tiktok', 'referral',
  'email', 'direct', 'outro',
]

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('marketing', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { startsWith: 'marketing.investment.' } },
      select: { key: true, value: true },
    })

    const investments: Record<string, number> = {}
    for (const s of settings) {
      const channel = s.key.replace('marketing.investment.', '')
      investments[channel] = parseInt(s.value) || 0
    }

    return success({ investments })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('marketing', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const channel = String(body.channel || '').trim()
    const rawAmount = Number(body.amount_cents)
    if (!Number.isFinite(rawAmount)) {
      return error('amount_cents deve ser um número finito', 400)
    }
    const amountCents = Math.max(0, Math.round(rawAmount))
    // R$ 100mi/mês cap (centavos) — investimento mensal além disso é claramente input errado
    if (amountCents > 10_000_000_000) {
      return error('amount_cents acima do limite razoável (R$ 100M/mês)', 400)
    }

    if (!channel || !ALLOWED_CHANNELS.includes(channel)) {
      return error(`Canal inválido. Permitidos: ${ALLOWED_CHANNELS.join(', ')}`, 400)
    }

    const key = `marketing.investment.${channel}`
    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key } },
      create: { company_id: user.companyId, key, value: String(amountCents), type: 'number' },
      update: { value: String(amountCents) },
    })

    return success({ channel, amount_cents: amountCents })
  } catch (err) {
    return handleError(err)
  }
}
