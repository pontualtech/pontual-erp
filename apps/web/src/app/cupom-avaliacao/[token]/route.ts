import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import crypto from 'crypto'

/**
 * GET /cupom-avaliacao/[token]
 *
 * Endpoint publico que o cliente acessa via link WhatsApp (enviado
 * pelo cron google-reviews). Fluxo:
 *  1. Decodifica token (HMAC com company_id + customer_id)
 *  2. Registra o clique nas OS recentes do cliente (review_reminder_sent_at) p/ não mandar lembrete
 *  3. Redireciona pra URL do Google Meu Negocio da empresa
 *
 * 2026-10-14: NÃO cria mais cupom aqui. Cupom ligado ao clique de avaliação é incentivo condicionado
 * (proibido pelo Google); o cupom de fidelidade agora é dado na entrega (lib/loyalty/delivery-coupon).
 *
 * Confiamos no clique: se a pessoa clicou no link, assumimos que esta
 * indo avaliar. API do Google My Business pra verificacao real exige
 * OAuth complexo; o ganho operacional nao compensa.
 */

// Auditoria 24/05: fallback-dev-secret removido. Sprint Auth NOTA 10 removeu
// em outros endpoints; este sobreviveu. Sem env, atacante forjaria cupons.
// Em prod fail-closed; em dev usa fallback ainda pra permitir testes locais.
function getSecret(): string {
  const s = process.env.ERP_TOKEN_SECRET || process.env.CRON_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ERP_TOKEN_SECRET (ou CRON_SECRET) obrigatório em produção')
  }
  return 'fallback-dev-secret-local-only'
}
// Token expira em 90 dias — evita reutilizacao indefinida se cliente
// re-encaminhar o link apos meses. 90d e folga confortavel pra cliente
// que demora pra abrir a mensagem.
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000
// O lembrete sai 24–48h após o pedido; 3 dias cobre o pedido que gerou este clique.
const CLICK_MARK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

function verifyToken(token: string): { companyId: string; customerId: string } | null {
  try {
    const [payloadB64, sig] = token.split('.')
    if (!payloadB64 || !sig) return null
    const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest('base64url')
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

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const decoded = verifyToken(params.token)

  // Tentativa de token invalido — manda direto pro site
  if (!decoded) {
    return NextResponse.redirect('https://www.pontualtech.com.br/', 302)
  }

  // Busca URL de reviews da empresa
  const setting = await prisma.setting.findFirst({
    where: { company_id: decoded.companyId, key: 'google_reviews.url' },
  })
  const reviewsUrl = setting?.value

  // Audit #16 (2026-05-29): fail-closed se URL nao configurada — redireciona pro site + log pro admin notar.
  if (!reviewsUrl) {
    console.warn(`[cupom-avaliacao] google_reviews.url nao configurado pra company_id=${decoded.companyId}`)
    return NextResponse.redirect('https://www.pontualtech.com.br/', 302)
  }

  // Marca as OS recentes do cliente como 'já clicou' — o passe de lembrete (cron google-reviews) só
  // considera OS com review_reminder_sent_at nulo. Falha aqui não impede o cliente de avaliar.
  try {
    await prisma.serviceOrder.updateMany({
      where: {
        company_id: decoded.companyId,
        customer_id: decoded.customerId,
        review_request_sent_at: { gte: new Date(Date.now() - CLICK_MARK_WINDOW_MS) },
        review_reminder_sent_at: null,
      },
      data: { review_reminder_sent_at: new Date() },
    })
  } catch (err) {
    console.warn('[cupom-avaliacao] falha ao registrar clique:', err instanceof Error ? err.message : String(err))
  }

  return NextResponse.redirect(reviewsUrl, 302)
}
