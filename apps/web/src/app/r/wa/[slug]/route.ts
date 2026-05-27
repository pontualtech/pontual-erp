import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * GET /r/wa/[slug]
 *
 * Redirect publico de email cold/newsletter pro WhatsApp limpo. Resolve
 * o problema de tags `[origem: ...]` vazando no `wa.me/?text=...` que o
 * cliente via no proprio celular ao clicar no botao "Falar no WhatsApp".
 *
 * Fluxo:
 *   1. Cliente clica botao no email -> bate aqui (pontualtech.com.br/r/wa/email3)
 *   2. Server registra um row em MarketingWhatsappRedirect (utm_campaign=slug)
 *   3. 302 -> https://wa.me/<phone>?text=<texto natural SEM tag>
 *
 * Atribuicao funciona via cruzamento phone + timing (<30min, expires_at). O
 * bot Marta/Ana ja faz esse match em /api/chatwoot/bot. NAO depende de
 * `[ref:...]` no texto.
 *
 * Slug nao reconhecido = redirect pro home. Mapping inline porque sao
 * poucas campanhas e a tabela so ganharia overhead de query a cada click.
 */

const PT_COMPANY = 'pontualtech-001'

interface CampaignConfig {
  phone: string
  text: string
  medium: string
}

const CAMPAIGNS: Record<string, CampaignConfig> = {
  email2: {
    phone: '5511965760126',
    text: 'Oi, li o email da PontualTech sobre os 3 erros que matam a impressora. Queria uma opinião sobre a minha:',
    medium: 'newsletter',
  },
  email3: {
    phone: '551131360415',
    text: 'Oi, li o email da PontualTech. Tenho o seguinte equipamento com problema:',
    medium: 'cold_b2b',
  },
  email4: {
    phone: '551131360415',
    text: 'Oi, li o email da PontualTech. Tenho o seguinte problema:',
    medium: 'cold_b2c',
  },
  winback: {
    phone: '5511965760126',
    text: 'Oi, sou cliente PontualTech e vi o email sobre conserto de notebook com 10% off. Tenho um notebook com o seguinte problema:',
    medium: 'winback',
  },
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const config = CAMPAIGNS[params.slug]
  if (!config) {
    // Slug invalido: home neutro, sem leak de erro
    return NextResponse.redirect('https://pontualtech.com.br/', 302)
  }

  const url = new URL(req.url)
  const segment = url.searchParams.get('s')

  // Best-effort log — atribuicao funciona pelo cruzamento phone+timing
  // no bot quando msg incoming chega. Falha no log NAO trava redirect.
  try {
    await prisma.marketingWhatsappRedirect.create({
      data: {
        company_id: PT_COMPANY,
        phone_destination: config.phone,
        utm_source: 'email',
        utm_medium: config.medium,
        utm_campaign: params.slug,
        utm_content: segment,
        page_url: req.headers.get('referer') || null,
        user_agent: req.headers.get('user-agent')?.slice(0, 500) || null,
      },
    })
  } catch (e) {
    console.error('[r/wa] log fail', e instanceof Error ? e.message : e)
  }

  const target = `https://wa.me/${config.phone}?text=${encodeURIComponent(config.text)}`
  return NextResponse.redirect(target, 302)
}
