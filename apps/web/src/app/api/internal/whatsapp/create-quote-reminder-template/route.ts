import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireInternalKey } from '@/lib/internal-auth'

/**
 * POST /api/internal/whatsapp/create-quote-reminder-template
 *
 * Cria template quote_approval_reminder_pt_br no Meta (Wave AE-1).
 * Disparado pelo cron diário de lembrete de orçamento quando OS está
 * há N dias em "Aguardando Aprovação" e cliente tem Customer.mobile
 * (e custom_data.disable_reminders !== true).
 *
 * Vars do body:
 *   {{1}} = primeiro_nome do cliente
 *   {{2}} = número da OS
 *   {{3}} = dias aguardando aprovação
 *
 * Button URL: short-link /s/[slug] que resolve pro magic-link do portal
 * (auto-login + landing direto no orçamento da OS).
 *
 * Categoria UTILITY (notif transacional sobre OS existente).
 *
 * Prefixo "Oi {{1}}!" — Meta rejeita template se {{1}} é primeira palavra
 * do body (feedback_meta_template_variable_position).
 */
export async function POST(req: NextRequest) {
  const guard = requireInternalKey(req); if (guard) return guard

  const body = await req.json().catch(() => ({}))
  const { company_id, waba_id: wabaIdFromBody } = body
  if (!company_id) return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  const wabaId = wabaIdFromBody || cfg['whatsapp.cloud.business_account_id'] || cfg['whatsapp.cloud.waba_id']

  if (!token) return NextResponse.json({ error: 'Missing whatsapp.cloud.access_token' }, { status: 400 })
  if (!wabaId) return NextResponse.json({ error: 'Missing whatsapp.cloud.business_account_id' }, { status: 400 })

  const templateBody = {
    name: 'quote_approval_reminder_pt_br',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Oi {{1}}! 👋 O orçamento da sua OS #{{2}} está aguardando aprovação há {{3}} dias. Você pode aprovar ou recusar diretamente pelo seu Portal.',
        example: {
          body_text: [['João', '60123', '5']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Ver Orçamento',
            url: 'https://portal.pontualtech.com.br/s/{{1}}',
            example: ['https://portal.pontualtech.com.br/s/abc123xy'],
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
    return NextResponse.json({
      success: res.ok,
      status: res.status,
      template_name: 'quote_approval_reminder_pt_br',
      meta_response: data,
    }, { status: res.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Meta API call failed', detail: String(err) }, { status: 500 })
  }
}
