import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireInternalKey } from '@/lib/internal-auth'

const PORTAL_DOMAIN_BY_SLUG: Record<string, string> = {
  pontualtech: 'portal.pontualtech.com.br',
  imprimitech: 'portal.imprimitech.com.br',
}

function portalBaseForSlug(slug: string): string {
  const domain = PORTAL_DOMAIN_BY_SLUG[slug] || `portal.${slug}.com.br`
  return `https://${domain}/portal/${slug}`
}

// Meta templates: each component (BODY, BUTTON) has its own independent variable numbering.
// So every URL button always uses {{1}} — it's the first (only) variable of that button.
function magicLinkButton(portalBase: string, text: string) {
  return {
    type: 'BUTTONS',
    buttons: [
      {
        type: 'URL',
        text,
        url: `${portalBase}/entrar?t={{1}}`,
        example: [`${portalBase}/entrar?t=example_token_xxx`],
      },
    ],
  }
}

function buildTemplatesPT(portalBase: string) {
  return [
  {
    name: 'pt_coleta_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Coleta agendada' },
      {
        type: 'BODY',
        text: 'PontualTech informa: a coleta do equipamento da OS numero {{1}} foi agendada. Nosso motorista passara no endereco cadastrado em horario comercial. Prepare o equipamento com cabos e fontes.',
        example: { body_text: [['60049']] },
      },
      { type: 'FOOTER', text: 'Toque no botao para acompanhar sua OS' },
      magicLinkButton(portalBase, 'Acompanhar OS'),
    ],
  },
  {
    name: 'pt_os_aberta_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Sua OS foi aberta' },
      {
        type: 'BODY',
        text: 'PontualTech informa: sua Ordem de Servico numero {{1}} foi registrada com sucesso. Equipamento: {{2}}. Acompanhe o andamento pelo portal.',
        example: { body_text: [['60049', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Acompanhar OS'),
    ],
  },
  {
    name: 'pontualtech_pronto_v2',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Equipamento pronto' },
      {
        type: 'BODY',
        text: 'PontualTech informa: o equipamento da OS numero {{1}} esta pronto para retirada. Equipamento: {{2}}. Retire na Rua Ouvidor Peleja, 660 - Vila Mariana. Horario: Seg-Qui 8h-18h, Sex 8h-17h.',
        example: { body_text: [['60049', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Ver detalhes'),
    ],
  },
  {
    name: 'pontualtech_orcamento_v2',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Orcamento pronto' },
      {
        type: 'BODY',
        text: 'PontualTech informa: o orcamento da OS numero {{1}} esta pronto. Valor total: {{2}}. Equipamento: {{3}}. Toque no botao para aprovar, recusar ou ver detalhes.',
        example: { body_text: [['60049', 'R$ 635,03', 'Impressora Canon G3111']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Aprovar ou Recusar'),
    ],
  },
  {
    name: 'pontualtech_status_os_v2',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Atualizacao da sua OS' },
      {
        type: 'BODY',
        text: 'PontualTech informa: a OS numero {{1}} foi atualizada para o status *{{2}}*. Equipamento: {{3}}. Acompanhe todos os detalhes pelo portal.',
        example: { body_text: [['60049', 'Em Execucao', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Acompanhar OS'),
    ],
  },
  {
    name: 'pt_cobranca_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Cobranca disponivel' },
      {
        type: 'BODY',
        text: 'PontualTech informa: voce tem uma cobranca no valor de {{1}} referente a OS numero {{2}}. Pague de forma rapida e segura pelo link abaixo.',
        example: { body_text: [['R$ 635,03', '60049']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Pagar Agora'),
    ],
  },
  {
    name: 'pt_followup_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Precisamos da sua resposta' },
      {
        type: 'BODY',
        text: 'PontualTech informa: identificamos que a OS numero {{1}} aguarda sua resposta. Equipamento: {{2}}. Toque no botao para ver os detalhes.',
        example: { body_text: [['60049', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Ver OS'),
    ],
  },
  ]
}

function buildTemplatesIMP(portalBase: string) {
  return [
  {
    name: 'imp_coleta_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Coleta agendada' },
      {
        type: 'BODY',
        text: 'Imprimitech informa: a coleta do equipamento da OS numero {{1}} foi agendada. Nosso motorista passara no endereco cadastrado em horario comercial. Prepare o equipamento com cabos e fontes.',
        example: { body_text: [['10049']] },
      },
      { type: 'FOOTER', text: 'Toque no botao para acompanhar sua OS' },
      magicLinkButton(portalBase, 'Acompanhar OS'),
    ],
  },
  {
    name: 'imp_os_aberta_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Sua OS foi aberta' },
      {
        type: 'BODY',
        text: 'Imprimitech informa: sua Ordem de Servico numero {{1}} foi registrada com sucesso. Equipamento: {{2}}. Acompanhe o andamento pelo portal.',
        example: { body_text: [['10049', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Acompanhar OS'),
    ],
  },
  {
    name: 'imp_pronto_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Equipamento pronto' },
      {
        type: 'BODY',
        text: 'Imprimitech informa: o equipamento da OS numero {{1}} esta pronto para retirada. Equipamento: {{2}}. Retire na Rua Paranaubis, 312 - Vila California, Sao Paulo. Horario comercial.',
        example: { body_text: [['10049', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Ver detalhes'),
    ],
  },
  {
    name: 'imp_orcamento_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Orcamento pronto' },
      {
        type: 'BODY',
        text: 'Imprimitech informa: o orcamento da OS numero {{1}} esta pronto. Valor total: {{2}}. Equipamento: {{3}}. Toque no botao para aprovar, recusar ou ver detalhes.',
        example: { body_text: [['10049', 'R$ 635,03', 'Impressora Canon G3111']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Aprovar ou Recusar'),
    ],
  },
  {
    name: 'imp_status_os_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Atualizacao da sua OS' },
      {
        type: 'BODY',
        text: 'Imprimitech informa: a OS numero {{1}} foi atualizada para o status *{{2}}*. Equipamento: {{3}}. Acompanhe todos os detalhes pelo portal.',
        example: { body_text: [['10049', 'Em Execucao', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Acompanhar OS'),
    ],
  },
  {
    name: 'imp_cobranca_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Cobranca disponivel' },
      {
        type: 'BODY',
        text: 'Imprimitech informa: voce tem uma cobranca no valor de {{1}} referente a OS numero {{2}}. Pague de forma rapida e segura pelo link abaixo.',
        example: { body_text: [['R$ 635,03', '10049']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Pagar Agora'),
    ],
  },
  {
    name: 'imp_followup_v3',
    language: 'pt_BR',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Precisamos da sua resposta' },
      {
        type: 'BODY',
        text: 'Imprimitech informa: identificamos que a OS numero {{1}} aguarda sua resposta. Equipamento: {{2}}. Toque no botao para ver os detalhes.',
        example: { body_text: [['10049', 'Impressora Epson L3250']] },
      },
      { type: 'FOOTER', text: 'Acesso direto - sem senha' },
      magicLinkButton(portalBase, 'Ver OS'),
    ],
  },
  ]
}

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
  if (!token || !wabaId) return NextResponse.json({ error: 'not configured' }, { status: 400 })

  const portalBase = portalBaseForSlug(company.slug)
  const templates = company.slug.includes('imprimitech')
    ? buildTemplatesIMP(portalBase)
    : buildTemplatesPT(portalBase)
  const results: any[] = []
  for (const tmpl of templates) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tmpl),
      })
      const data = await res.json()
      results.push({ name: tmpl.name, status: res.status, response: data })
    } catch (e: any) {
      results.push({ name: tmpl.name, error: String(e) })
    }
  }

  return NextResponse.json({ results })
}
