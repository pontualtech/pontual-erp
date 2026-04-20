import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/admin/whatsapp/create-otp-template
 *
 * One-shot endpoint to register the OTP template in Meta WhatsApp Business.
 * Requires X-Internal-Key header.
 *
 * Body: { company_id: string }
 * Reads whatsapp.cloud.{access_token, business_account_id} from Settings.
 */
export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key')
  const validKeys = [
    process.env.INTERNAL_API_KEY,
    process.env.BOT_WEBHOOK_SECRET,
    process.env.CRON_SECRET,
    process.env.CHATWOOT_WEBHOOK_SECRET,
  ].filter(Boolean)
  if (!internalKey || !validKeys.includes(internalKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { company_id, waba_id: wabaIdFromBody } = body
  if (!company_id) return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  let wabaId = wabaIdFromBody || cfg['whatsapp.cloud.business_account_id'] || cfg['whatsapp.cloud.waba_id']
  const phoneNumberId = cfg['whatsapp.cloud.phone_number_id']

  if (!token) {
    return NextResponse.json({ error: 'Missing whatsapp.cloud.access_token' }, { status: 400 })
  }

  // Auto-discover WABA ID. Try multiple strategies.
  let discoveryDebug: any = { attempts: [] }
  if (!wabaId && phoneNumberId) {
    // Strategy 1: debug_token returns granular_scopes including WABA
    try {
      const dbgRes = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${token}&access_token=${token}`)
      const dbg = await dbgRes.json()
      discoveryDebug.attempts.push({ strategy: 'debug_token', response: dbg })
      const scopes = dbg?.data?.granular_scopes
      if (scopes) {
        for (const s of scopes) {
          if (s.scope === 'whatsapp_business_management' && s.target_ids?.length) {
            wabaId = s.target_ids[0]
            break
          }
        }
      }
    } catch (e: any) {
      discoveryDebug.attempts.push({ strategy: 'debug_token', error: String(e) })
    }

    // Strategy 2: System User is associated with a Business — find via /me/businesses with app token
    if (!wabaId) {
      try {
        const bizRes = await fetch(`https://graph.facebook.com/v21.0/me/businesses?access_token=${token}`)
        const biz = await bizRes.json()
        discoveryDebug.attempts.push({ strategy: 'me_businesses', status: bizRes.status, response: biz })
        for (const b of (biz?.data || [])) {
          const wabaRes = await fetch(
            `https://graph.facebook.com/v21.0/${b.id}/owned_whatsapp_business_accounts?access_token=${token}`
          )
          const wbs = await wabaRes.json()
          discoveryDebug.attempts.push({ strategy: `owned_wabas:${b.id}`, status: wabaRes.status, response: wbs })
          for (const w of (wbs?.data || [])) {
            const phonesRes = await fetch(
              `https://graph.facebook.com/v21.0/${w.id}/phone_numbers?access_token=${token}`
            )
            const phones = await phonesRes.json()
            if (phones?.data?.some((p: any) => p.id === phoneNumberId)) {
              wabaId = w.id
              break
            }
          }
          if (wabaId) break
        }
      } catch (e: any) {
        discoveryDebug.attempts.push({ strategy: 'me_businesses', error: String(e) })
      }
    }

    // Strategy 3: list all WABAs via the app itself
    if (!wabaId) {
      try {
        const appId = discoveryDebug.attempts[0]?.response?.data?.app_id
        if (appId) {
          const appRes = await fetch(
            `https://graph.facebook.com/v21.0/${appId}/owned_whatsapp_business_accounts?access_token=${token}`
          )
          const app = await appRes.json()
          discoveryDebug.attempts.push({ strategy: 'app_owned_wabas', status: appRes.status, response: app })
          for (const w of (app?.data || [])) {
            const phonesRes = await fetch(
              `https://graph.facebook.com/v21.0/${w.id}/phone_numbers?access_token=${token}`
            )
            const phones = await phonesRes.json()
            if (phones?.data?.some((p: any) => p.id === phoneNumberId)) {
              wabaId = w.id
              break
            }
          }
        }
      } catch (e: any) {
        discoveryDebug.attempts.push({ strategy: 'app_owned_wabas', error: String(e) })
      }
    }
  }

  if (!wabaId) {
    return NextResponse.json({
      error: 'Cannot determine WABA ID',
      detail: { has_token: true, has_phone_id: !!phoneNumberId, phone_number_id: phoneNumberId, discovery: discoveryDebug },
    }, { status: 400 })
  }

  // Authentication template — approved in minutes, optimized for OTPs
  const templateBody = {
    name: 'pt_portal_otp',
    language: 'pt_BR',
    category: 'AUTHENTICATION',
    components: [
      {
        type: 'BODY',
        text: '{{1}} é seu código de acesso ao Portal do Cliente. Este código expira em 10 minutos.',
        add_security_recommendation: true,
        example: { body_text: [['123456']] },
      },
      {
        type: 'FOOTER',
        code_expiration_minutes: 10,
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'OTP',
            otp_type: 'COPY_CODE',
            text: 'Copiar código',
          },
        ],
      },
    ],
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(templateBody),
    })

    const data = await res.json()

    // Persist WABA ID if creation succeeded and it wasn't stored yet
    if (res.ok && wabaIdFromBody && !cfg['whatsapp.cloud.business_account_id']) {
      try {
        await prisma.setting.upsert({
          where: { company_id_key: { company_id, key: 'whatsapp.cloud.business_account_id' } },
          create: { company_id, key: 'whatsapp.cloud.business_account_id', value: wabaIdFromBody },
          update: { value: wabaIdFromBody },
        })
      } catch {}
    }

    return NextResponse.json({
      success: res.ok,
      status: res.status,
      waba_id_used: wabaId,
      meta_response: data,
      template_name: 'pt_portal_otp',
    }, { status: res.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Meta API call failed', detail: String(err) }, { status: 500 })
  }
}
