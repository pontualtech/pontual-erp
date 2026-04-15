import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'

/**
 * GET /api/cron/bot-followup
 *
 * Called by external cron (n8n, crontab) every 5 minutes.
 * Processes all bot conversations that have a pending follow-up.
 *
 * Flow:
 *   1. Find conversations where follow_up_next_at <= NOW()
 *   2. Load company-specific follow-up settings (messages, intervals)
 *   3. Send the appropriate follow-up message via Chatwoot
 *   4. Schedule the next follow-up or mark as complete
 *
 * Protected by CRON_SECRET in Authorization header.
 */

// Multi-tenant bot config (mirrors the bot route)
interface BotCompanyConfig {
  companyId: string
  slug: string
  cwUrl: string
  cwAccountId: string
  cwToken: string
  supportWhatsApp: string
}

// ENV-based secrets (API tokens must stay in env vars)
const ENV_TOKENS: Record<string, string> = {
  'pontualtech-001': process.env.CHATWOOT_API_TOKEN || process.env.CW_ADMIN_TOKEN || '',
  '86c829cf-32ed-4e40-80cd-59ce4178aa1a': process.env.CW_IMPRI_TOKEN || '',
}

/** Load bot company config from DB settings (cached per request batch) */
const cwConfigCache = new Map<string, BotCompanyConfig | null>()

async function getCompanyCwConfig(companyId: string): Promise<BotCompanyConfig | null> {
  if (cwConfigCache.has(companyId)) return cwConfigCache.get(companyId)!

  const settings = await prisma.setting.findMany({
    where: { company_id: companyId, key: { startsWith: 'bot.config.' } },
  })
  if (settings.length === 0) { cwConfigCache.set(companyId, null); return null }

  const db: Record<string, string> = {}
  for (const s of settings) db[s.key] = s.value

  const cfg: BotCompanyConfig = {
    companyId,
    slug: db['bot.config.slug'] || companyId,
    cwUrl: db['bot.config.cw_url'] || '',
    cwAccountId: db['bot.config.cw_account_id'] || '1',
    cwToken: ENV_TOKENS[companyId] || '',
    supportWhatsApp: db['bot.config.support_whatsapp'] || '',
  }

  cwConfigCache.set(companyId, cfg.cwUrl ? cfg : null)
  return cfg.cwUrl ? cfg : null
}

// Default follow-up settings (used when company has no custom config)
const DEFAULTS: Record<string, string> = {
  'bot.followup.enabled': 'true',
  'bot.followup.max_attempts': '3',
  'bot.followup.interval_1_minutes': '60',
  'bot.followup.interval_2_minutes': '1440',
  'bot.followup.interval_3_minutes': '4320',
  'bot.followup.interval_4_minutes': '10080',
  'bot.followup.interval_5_minutes': '20160',
  'bot.followup.interval_6_minutes': '43200',
  'bot.followup.msg_1': 'Oi! 😊 Vi que voce nao respondeu. Posso te ajudar com algo?',
  'bot.followup.msg_2': 'Ola! Passando para saber se ainda precisa de ajuda. E so me chamar! 🔧',
  'bot.followup.msg_3': 'Oi! Essa e minha ultima mensagem automatica. Se precisar, estamos a disposicao! 👋',
  'bot.followup.msg_4': 'Ola! Faz uma semana que conversamos. Se precisar de assistencia tecnica, estamos aqui!',
  'bot.followup.msg_5': 'Oi! So passando para lembrar que estamos a disposicao. Qualquer duvida, e so chamar!',
  'bot.followup.msg_6': 'Ola! Faz um tempo que nao nos falamos. Se precisar de servicos tecnicos, conte conosco! 🔧',
  'bot.followup.business_hours_only': 'true',
  'bot.followup.business_hour_start': '8',
  'bot.followup.business_hour_end': '18',
  'bot.followup.business_days': '1,2,3,4,5',
}

export async function GET(request: NextRequest) {
  try {
    // Validate cron secret
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[Cron/BotFollowUp] CRON_SECRET not configured')
      return error('Cron not configured', 503)
    }

    const authHeader = request.headers.get('authorization')
    const expected = `Bearer ${cronSecret}`
    if (!authHeader || authHeader.length !== expected.length
      || !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
      return error('Unauthorized', 401)
    }

    // Find all conversations with pending follow-ups
    const now = new Date()
    const pendingConvs = await prisma.botConversation.findMany({
      where: {
        follow_up_next_at: { lte: now },
        follow_up_opted_out: false,
        human_takeover: false,
        company_id: { not: 'LOG' }, // exclude diagnostic log entries
      },
      take: 100, // batch limit
    })

    if (pendingConvs.length === 0) {
      return success({ processed: 0, message: 'No pending follow-ups' })
    }

    // Group by company_id to load settings per company
    const companyIds = [...new Set(pendingConvs.map(c => c.company_id))]
    const settingsMap = new Map<string, Record<string, string>>()

    for (const companyId of companyIds) {
      const settings = await prisma.setting.findMany({
        where: {
          company_id: companyId,
          key: { startsWith: 'bot.followup.' },
        },
      })
      const cfg = { ...DEFAULTS }
      for (const s of settings) {
        cfg[s.key] = s.value
      }
      settingsMap.set(companyId, cfg)
    }

    let sent = 0
    let skipped = 0
    const errors: string[] = []

    for (const conv of pendingConvs) {
      try {
        const cfg = settingsMap.get(conv.company_id) || DEFAULTS
        const cwCfg = await getCompanyCwConfig(conv.company_id)

        // Skip if follow-up disabled for this company
        if (cfg['bot.followup.enabled'] !== 'true') {
          await clearFollowUp(conv.id)
          skipped++
          continue
        }

        // Skip if no Chatwoot config
        if (!cwCfg) {
          console.warn(`[Cron/BotFollowUp] No Chatwoot config for company ${conv.company_id}`)
          await clearFollowUp(conv.id)
          skipped++
          continue
        }

        // Skip if conversation is resolved in Chatwoot (double-check)
        try {
          const convRes = await fetch(
            `${cwCfg.cwUrl}/api/v1/accounts/${cwCfg.cwAccountId}/conversations/${conv.chatwoot_conv_id}`,
            { headers: { api_access_token: cwCfg.cwToken }, signal: AbortSignal.timeout(5000) }
          )
          if (convRes.ok) {
            const convData = await convRes.json()
            if (convData.status === 'resolved') {
              await clearFollowUp(conv.id)
              skipped++
              continue
            }
          }
        } catch {} // If Chatwoot is down, proceed with follow-up anyway

        const maxAttempts = parseInt(cfg['bot.followup.max_attempts'] || '3')
        const nextCount = conv.follow_up_count + 1

        // Already hit max follow-ups
        if (nextCount > maxAttempts) {
          await clearFollowUp(conv.id)
          skipped++
          continue
        }

        // Check business hours
        if (cfg['bot.followup.business_hours_only'] === 'true') {
          const nowBR = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
          const hour = nowBR.getHours()
          const dayOfWeek = nowBR.getDay() // 0=Sun, 1=Mon, ...
          const startHour = parseInt(cfg['bot.followup.business_hour_start'] || '8')
          const endHour = parseInt(cfg['bot.followup.business_hour_end'] || '18')
          const allowedDays = (cfg['bot.followup.business_days'] || '1,2,3,4,5').split(',').map(Number)

          if (!allowedDays.includes(dayOfWeek) || hour < startHour || hour >= endHour) {
            // Outside business hours — reschedule for next business day at start hour
            const nextBizDate = getNextBusinessDay(nowBR, allowedDays, startHour)
            await prisma.botConversation.update({
              where: { id: conv.id },
              data: { follow_up_next_at: nextBizDate },
            })
            skipped++
            continue
          }
        }

        // ── Send via WhatsApp Cloud API template (with button) ──
        // Look up latest OS for this customer to fill template params
        let osNum = '0000'
        let equipment = 'Equipamento'

        // Try by customer_id first, then fall back to phone number lookup
        let latestOs = null
        if (conv.customer_id) {
          latestOs = await prisma.serviceOrder.findFirst({
            where: { customer_id: conv.customer_id, company_id: conv.company_id, deleted_at: null },
            orderBy: { created_at: 'desc' },
            select: { os_number: true, equipment_type: true, equipment_brand: true, equipment_model: true },
          }).catch(() => null)
        }
        if (!latestOs && conv.customer_phone) {
          // Search by phone number — strip +55 and non-digits for flexible matching
          const cleanPhone = conv.customer_phone.replace(/\D/g, '').replace(/^55/, '')
          const customerByPhone = await prisma.customer.findFirst({
            where: {
              company_id: conv.company_id,
              OR: [
                { mobile: { contains: cleanPhone } },
                { phone: { contains: cleanPhone } },
              ],
            },
            select: { id: true },
          }).catch(() => null)
          if (customerByPhone) {
            latestOs = await prisma.serviceOrder.findFirst({
              where: { customer_id: customerByPhone.id, company_id: conv.company_id, deleted_at: null },
              orderBy: { created_at: 'desc' },
              select: { os_number: true, equipment_type: true, equipment_brand: true, equipment_model: true },
            }).catch(() => null)
          }
        }
        if (latestOs) {
          osNum = String(latestOs.os_number).padStart(4, '0')
          equipment = [latestOs.equipment_type, latestOs.equipment_brand, latestOs.equipment_model].filter(Boolean).join(' ') || 'Equipamento'
        }

        const phone = conv.customer_phone
        if (!phone) {
          console.warn(`[Cron/BotFollowUp] No phone for conv ${conv.chatwoot_conv_id}, skipping`)
          await clearFollowUp(conv.id)
          skipped++
          continue
        }

        const templateResult = await sendWhatsAppTemplate(conv.company_id, phone, 'pt_followup_v2', 'pt_BR', [
          { type: 'body', parameters: [
            { type: 'text', text: osNum },
            { type: 'text', text: equipment },
          ] }
        ]).catch(err => {
          console.error(`[Cron/BotFollowUp] Template send failed conv ${conv.chatwoot_conv_id}:`, err)
          return { success: false }
        })

        if (!templateResult.success) {
          errors.push(`Conv ${conv.chatwoot_conv_id}: template send failed`)
          continue
        }

        // Update follow-up state
        const nextFollowUpAt = nextCount < maxAttempts
          ? getNextFollowUpTime(now, nextCount + 1, cfg)
          : null // no more follow-ups

        await prisma.botConversation.update({
          where: { id: conv.id },
          data: {
            follow_up_count: nextCount,
            follow_up_next_at: nextFollowUpAt,
          },
        })

        // Internal note for agents (so they see the follow-up in Chatwoot)
        if (cwCfg) {
          await fetch(
            `${cwCfg.cwUrl}/api/v1/accounts/${cwCfg.cwAccountId}/conversations/${conv.chatwoot_conv_id}/messages`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                api_access_token: cwCfg.cwToken,
              },
              body: JSON.stringify({
                content: `[BOT] 📬 Follow-up #${nextCount}/${maxAttempts} enviado via WhatsApp template (pt_followup_v2) — OS #${osNum}.${nextFollowUpAt ? ` Proximo: ${nextFollowUpAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ' (ultimo)'}`,
                message_type: 'outgoing',
                private: true,
              }),
            }
          ).catch(() => {})
        }

        console.log(`[Cron/BotFollowUp] Sent follow-up #${nextCount} to conv ${conv.chatwoot_conv_id} (${cwCfg.slug})`)
        sent++
      } catch (err) {
        console.error(`[Cron/BotFollowUp] Error processing conv ${conv.id}:`, err)
        errors.push(`Conv ${conv.id}: ${err instanceof Error ? err.message : 'unknown'}`)
      }
    }

    return success({ processed: pendingConvs.length, sent, skipped, errors })
  } catch (err) {
    return handleError(err)
  }
}

/** Clear follow-up schedule for a conversation */
async function clearFollowUp(botConvId: string) {
  await prisma.botConversation.update({
    where: { id: botConvId },
    data: { follow_up_next_at: null },
  })
}

/** Calculate the next follow-up time based on interval settings */
function getNextFollowUpTime(from: Date, attemptNumber: number, cfg: Record<string, string>): Date {
  const key = `bot.followup.interval_${attemptNumber}_minutes`
  const minutes = parseInt(cfg[key] || '1440') // default 24h
  return new Date(from.getTime() + minutes * 60 * 1000)
}

/** Find the next business day at the given start hour (São Paulo timezone) */
function getNextBusinessDay(now: Date, allowedDays: number[], startHour: number): Date {
  const next = new Date(now)
  next.setHours(startHour, 0, 0, 0)

  // If we're past start hour today, move to next day
  if (now.getHours() >= startHour) {
    next.setDate(next.getDate() + 1)
  }

  // Find next allowed day (max 7 iterations)
  for (let i = 0; i < 7; i++) {
    if (allowedDays.includes(next.getDay())) break
    next.setDate(next.getDate() + 1)
  }

  return next
}
