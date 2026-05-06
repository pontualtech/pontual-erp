import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireInternalKey } from '@/lib/internal-auth'

const PORTAL_DOMAIN_BY_SLUG: Record<string, string> = {
  pontualtech: 'portal.pontualtech.com.br',
  imprimitech: 'portal.imprimitech.com.br',
}

/**
 * POST /api/internal/whatsapp/create-orcamento-v3-template
 *
 * Cria pontualtech_orcamento_v3 no Meta WABA da empresa.
 *
 * Decisao Karlao 2026-05-06: notificacao NAO deve mostrar valor.
 * Cliente vai pro portal pra ver detalhes (fotos, lauros, servicos)
 * antes de aprovar — evita rejeicao "as cegas" so pelo numero.
 *
 * Mudanca vs v2:
 *  - body: removido placeholder {{2}} (valor)
 *  - body: agora tem {{1}}=osNum, {{2}}=equipamento (era {{3}})
 *
 * Body, header, footer e botao mantem mesma linguagem UTILITY ja
 * aprovada pela Meta no v2 — menor risco de reprovacao.
 */
export async function POST(req: NextRequest) {
  const guard = requireInternalKey(req); if (guard) return guard

  const { company_id } = await req.json().catch(() => ({}))
  if (!company_id) return NextResponse.json({ error: 'company_id required' }, { status: 400 })

  const company = await prisma.company.findUnique({
    where: { id: company_id },
    select: { slug: true },
  })
  if (!company?.slug) return NextResponse.json({ error: 'company not found' }, { status: 404 })

  const settings = await prisma.setting.findMany({
    where: { company_id, key: { startsWith: 'whatsapp.cloud.' } },
  })
  const cfg: Record<string, string> = {}
  for (const s of settings) cfg[s.key] = s.value

  const token = cfg['whatsapp.cloud.access_token']
  const wabaId = cfg['whatsapp.cloud.business_account_id']
  if (!token || !wabaId) return NextResponse.json({ error: 'whatsapp.cloud.* nao configurado' }, { status: 400 })

  const portalDomain = PORTAL_DOMAIN_BY_SLUG[company.slug] || `portal.${company.slug}.com.br`
  const portalBase = `https://${portalDomain}/portal/${company.slug}`

  const templateBody = {
    name: 'pontualtech_orcamento_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Orcamento pronto' },
      {
        type: 'BODY',
        text: 'PontualTech informa: o orcamento da OS numero {{1}} esta pronto para sua avaliacao. Equipamento: {{2}}. Toque no botao para acessar o portal, ver os detalhes e aprovar ou recusar.',
        example: { body_text: [['60049', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Aprovar ou Recusar',
            url: `${portalBase}/entrar?t={{1}}`,
            example: [`${portalBase}/entrar?t=example_token_xxx`],
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
      template_name: 'pontualtech_orcamento_v3',
      company_slug: company.slug,
      meta_response: data,
    }, { status: res.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Meta API call failed', detail: String(err) }, { status: 500 })
  }
}
