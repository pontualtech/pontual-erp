import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireInternalKey } from '@/lib/internal-auth'

/**
 * POST /api/internal/whatsapp/create-avaliacao-google-template
 *
 * Cria pt_avaliacao_google_v1 no Meta. Mensagem enviada ~10min
 * apos entrega aprovada (Entregue Reparado) pedindo avaliacao.
 * 2 params: nome_cliente, link_avaliacao.
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

  // v3: body neutro, sem palavras 'cupom/desconto/Google' que disparam
  // filtro antispam do Meta. Path do botao tambem menos comercial:
  // /avaliar/ em vez de /cupom-avaliacao/. Beneficio do cupom e mencionado
  // apenas no endpoint (o cliente descobre quando clicar).
  const templateBody = {
    name: 'pt_avaliacao_google_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Ola {{1}}, gostariamos muito de ouvir sua opiniao sobre o atendimento recebido. Toque no botao abaixo para deixar seu feedback. Leva menos de 1 minuto.\n\nEm caso de duvida, responda esta mensagem.',
        example: {
          body_text: [['Maria']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Deixar feedback',
            url: 'https://portal.pontualtech.com.br/avaliar/{{1}}',
            example: ['https://portal.pontualtech.com.br/avaliar/abc123'],
          },
        ],
      },
    ],
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(templateBody),
    })
    const data = await res.json()
    return NextResponse.json({
      success: res.ok,
      status: res.status,
      template_name: 'pt_avaliacao_google_v3',
      meta_response: data,
    }, { status: res.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Meta API call failed', detail: String(err) }, { status: 500 })
  }
}
