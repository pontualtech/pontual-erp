import { createAccessToken } from '@/lib/portal-auth'

/**
 * M5 fix (audit): mapa centralizado slug → portal domain.
 * Antes existiam 3 cópias (este arquivo, lib/ai/handlers.ts,
 * api/chatwoot/bot/route.ts). Agora todos importam dessa fonte única.
 *
 * Onboarding de novo tenant: adicionar 1 linha aqui (até migração futura
 * pra companies.portal_url no DB, que requer schema change e codemod async).
 *
 * Override per-deploy via env `PORTAL_URL_BY_SLUG` JSON:
 *   PORTAL_URL_BY_SLUG='{"pontualtech":"portal.pontualtech.com.br",...}'
 */
function loadPortalDomainMap(): Record<string, string> {
  const base: Record<string, string> = {
    pontualtech: 'portal.pontualtech.com.br',
    imprimitech: 'portal.imprimitech.com.br',
  }
  const envOverride = process.env.PORTAL_URL_BY_SLUG
  if (envOverride) {
    try {
      const parsed = JSON.parse(envOverride)
      if (parsed && typeof parsed === 'object') {
        Object.assign(base, parsed)
      }
    } catch {
      console.warn('[portal-magic-url] PORTAL_URL_BY_SLUG inválido — ignorando')
    }
  }
  return base
}

export const PORTAL_DOMAIN_BY_SLUG: Record<string, string> = loadPortalDomainMap()

/**
 * Resolve domínio do portal pra um slug. Use isso em vez de hardcode.
 * Fallback: deriva `portal.${slug}.com.br` se slug desconhecido + warning.
 */
export function resolvePortalDomain(slug: string): string {
  const explicit = PORTAL_DOMAIN_BY_SLUG[slug]
  if (explicit) return explicit
  console.warn(`[portal-magic-url] slug "${slug}" não está em PORTAL_DOMAIN_BY_SLUG; derivando portal.${slug}.com.br. Adicionar em PORTAL_URL_BY_SLUG env ou no map base.`)
  return `portal.${slug}.com.br`
}

/**
 * Constroi a URL "magic-link" — auto-login do cliente sem senha,
 * ja redirecionado pra OS especifica (ou home do portal se osId omitido).
 *
 * Padrao usado em todos os endpoints de notificacao (email + WhatsApp fallback).
 *
 * Em vez de cada endpoint reimplementar getCloudConfig + createAccessToken +
 * URL formatting, todos chamam essa funcao. Garante consistencia: se mudar
 * o formato (ex: trocar param ?t= por outro), muda em 1 lugar.
 */
export function buildMagicLink(opts: {
  customerId: string
  companyId: string
  slug: string
  osId?: string
  redirectPath?: string
  portalUrlOverride?: string
}): { url: string; token: string } {
  const { customerId, companyId, slug, osId, redirectPath: rPath, portalUrlOverride } = opts
  const domain = resolvePortalDomain(slug)
  const portalBase = portalUrlOverride || process.env.PORTAL_URL || `https://${domain}`
  const token = createAccessToken(customerId, companyId)
  // redirectPath explicito tem precedencia (ex: pra ticket); senao osId; senao home.
  const finalRedirect = rPath || (osId ? `/portal/${slug}/os/${osId}` : `/portal/${slug}`)
  const redirect = encodeURIComponent(finalRedirect)
  return {
    url: `${portalBase}/portal/${slug}/entrar?t=${token}&r=${redirect}`,
    token,
  }
}
