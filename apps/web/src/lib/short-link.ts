import { prisma } from '@pontual/db'
import crypto from 'crypto'

/**
 * URL shortener self-hosted. Encurta magic-links portal gigantes (350+ chars
 * com JWT) pra slug curto bonito do tipo `pontualtech.com.br/s/aBc123`.
 *
 * Por que self-hosted: (1) URL na sua marca (reforca brand, nao parece spam),
 * (2) controla analytics (click_count, last_clicked_at), (3) nao depende de
 * bit.ly/etc com risco de quota ou ToS.
 *
 * Decisao Karlao 2026-05-05: visual feio com magic-link inline mata feeling
 * de atendimento humano nas conversas Marta.
 */

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const SLUG_LEN = 7  // 62^7 = 3.5 trilhoes — colisao improvavel

/** Generates a random slug. Retries on collision. */
function generateSlug(): string {
  let s = ''
  for (let i = 0; i < SLUG_LEN; i++) {
    const idx = crypto.randomInt(0, SLUG_ALPHABET.length)
    s += SLUG_ALPHABET[idx]
  }
  return s
}

/**
 * Returns the short URL base for a given company. Same domain as portal —
 * cliente ja confia visualmente. /s/SLUG path neutro.
 */
function shortBaseUrl(companyId: string): string {
  if (companyId === 'pontualtech-001') return 'https://portal.pontualtech.com.br'
  if (companyId === '86c829cf-32ed-4e40-80cd-59ce4178aa1a') return 'https://portal.imprimitech.com.br'
  return process.env.NEXT_PUBLIC_APP_URL || 'https://portal.pontualtech.com.br'
}

/**
 * Cria um short link pra uma URL alvo. Retorna a URL curta pronta pra usar.
 *
 * Default expiracao: 90 dias. URLs antigas viram 404 — magic-link tem 30d
 * (audit A8) entao 90d e folga confortavel.
 *
 * Idempotencia: se existir short link recente (< 1h) pro mesmo target_url +
 * customer_id, reusa. Evita poluir DB quando bot manda msgs em sequencia.
 */
export async function shortenUrl(
  targetUrl: string,
  companyId: string,
  customerId?: string,
  expiresInDays = 90,
): Promise<string> {
  // Reuse recent short link pra mesma combinacao (1h cache)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const existing = await prisma.shortLink.findFirst({
    where: {
      target_url: targetUrl,
      company_id: companyId,
      customer_id: customerId || null,
      created_at: { gte: oneHourAgo },
    },
    select: { slug: true },
    orderBy: { created_at: 'desc' },
  })
  if (existing) {
    return `${shortBaseUrl(companyId)}/s/${existing.slug}`
  }

  // Tenta inserir com slug random. Em caso de colisao, retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug()
    try {
      await prisma.shortLink.create({
        data: {
          slug,
          target_url: targetUrl,
          company_id: companyId,
          customer_id: customerId || null,
          expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
        },
      })
      return `${shortBaseUrl(companyId)}/s/${slug}`
    } catch (err: any) {
      if (err?.code === 'P2002') continue  // slug colision, retry
      throw err
    }
  }
  throw new Error('Falha ao gerar slug unico apos 5 tentativas (improvavel)')
}

/**
 * Detecta TODAS as URLs de portal num texto e substitui por shorts.
 * Util pra processar respostas do bot antes de mandar pro cliente.
 *
 * Detecta URLs portal pontualtech.com.br e portal.imprimitech.com.br.
 * Outras URLs (links externos, sites, etc) nao sao mexidas.
 */
export async function shortenAllPortalUrls(
  text: string,
  companyId: string,
  customerId?: string,
): Promise<string> {
  const urls = text.match(/https?:\/\/portal\.(pontualtech|imprimitech)\.com\.br\/[^\s)>\]]+/g) || []
  if (urls.length === 0) return text

  let result = text
  for (const url of urls) {
    try {
      const short = await shortenUrl(url, companyId, customerId)
      result = result.replace(url, short)
    } catch (err) {
      console.warn('[shortenAllPortalUrls] failed for url, keeping original:', err instanceof Error ? err.message : err)
    }
  }
  return result
}
