import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import crypto from 'crypto'

/**
 * GET /cupom-avaliacao/[token]
 *
 * Endpoint publico que o cliente acessa via link WhatsApp (enviado
 * pelo cron google-reviews). Fluxo:
 *  1. Decodifica token (HMAC com company_id + customer_id)
 *  2. Cria cupom permanente de 10% pro cliente (se ainda nao tem)
 *  3. Redireciona pra URL do Google Meu Negocio da empresa
 *
 * Confiamos no clique: se a pessoa clicou no link, assumimos que esta
 * indo avaliar. API do Google My Business pra verificacao real exige
 * OAuth complexo; o ganho operacional nao compensa.
 */

const SECRET = process.env.ERP_TOKEN_SECRET || process.env.CRON_SECRET || 'fallback-dev-secret'
const DEFAULT_PERCENT = 10
// Token expira em 90 dias — evita reutilizacao indefinida se cliente
// re-encaminhar o link apos meses. 90d e folga confortavel pra cliente
// que demora pra abrir a mensagem.
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000

function verifyToken(token: string): { companyId: string; customerId: string } | null {
  try {
    const [payloadB64, sig] = token.split('.')
    if (!payloadB64 || !sig) return null
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url')
    // timingSafeEqual pra nao vazar info por tempo (defense in depth)
    const a = Buffer.from(expectedSig); const b = Buffer.from(sig)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (!payload.c || !payload.u) return null
    if (!payload.t || Date.now() - Number(payload.t) > TOKEN_TTL_MS) return null
    return { companyId: String(payload.c), customerId: String(payload.u) }
  } catch {
    return null
  }
}

function generateCode(): string {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase()
  return `REVIEW-${rand}`
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const decoded = verifyToken(params.token)

  // Tentativa de token invalido — manda direto pro site (sem criar cupom)
  if (!decoded) {
    return NextResponse.redirect('https://www.pontualtech.com.br/', 302)
  }

  // Busca URL de reviews da empresa
  const setting = await prisma.setting.findFirst({
    where: { company_id: decoded.companyId, key: 'google_reviews.url' },
  })
  const reviewsUrl = setting?.value || 'https://www.google.com'

  try {
    // Unique constraint (company_id, customer_id, source='review')
    // garante 1 cupom por cliente. Create atomico — se ja existe, P2002
    // e tratado como "ja ganhou". Evita race quando cliente clica 2x.
    const pctSetting = await prisma.setting.findFirst({
      where: { company_id: decoded.companyId, key: 'loyalty.review_coupon_percent' },
    })
    const percent = pctSetting ? Math.max(1, Math.min(50, parseInt(pctSetting.value, 10) || DEFAULT_PERCENT)) : DEFAULT_PERCENT

    for (let i = 0; i < 5; i++) {
      const code = generateCode()
      try {
        await prisma.coupon.create({
          data: {
            company_id: decoded.companyId,
            customer_id: decoded.customerId,
            code,
            source: 'review',
            discount_type: 'percent',
            discount_value: percent,
            notes: `Gerado via clique no link de avaliacao Google (${new Date().toISOString()})`,
          },
        })
        break
      } catch (err: any) {
        if (err?.code === 'P2002') {
          // Conflito: ou codigo existente (retry com novo code), ou ja
          // tem cupom review desse cliente (unique na source — 'ja ganhou').
          // target nos logs indica qual constraint bateu.
          const target = err.meta?.target || []
          const isCodeClash = Array.isArray(target) && target.includes('code')
          if (isCodeClash) continue // gera outro code
          break // ja tem cupom review — sai silenciosamente
        }
        throw err
      }
    }
  } catch (err) {
    // Falha ao criar cupom nao impede o redirect — prioridade e o cliente avaliar
    console.warn('[cupom-avaliacao] falha ao criar cupom:', err instanceof Error ? err.message : String(err))
  }

  return NextResponse.redirect(reviewsUrl, 302)
}
