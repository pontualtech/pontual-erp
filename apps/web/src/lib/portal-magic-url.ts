import { createAccessToken } from '@/lib/portal-auth'

const PORTAL_DOMAIN_BY_SLUG: Record<string, string> = {
  pontualtech: 'portal.pontualtech.com.br',
  imprimitech: 'portal.imprimitech.com.br',
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
  portalUrlOverride?: string
}): { url: string; token: string } {
  const { customerId, companyId, slug, osId, portalUrlOverride } = opts
  const isImpri = slug.includes('imprimitech')
  const domain = PORTAL_DOMAIN_BY_SLUG[slug] || (isImpri ? 'portal.imprimitech.com.br' : 'portal.pontualtech.com.br')
  const portalBase = portalUrlOverride || process.env.PORTAL_URL || `https://${domain}`
  const token = createAccessToken(customerId, companyId)
  const redirectPath = osId ? `/portal/${slug}/os/${osId}` : `/portal/${slug}`
  const redirect = encodeURIComponent(redirectPath)
  return {
    url: `${portalBase}/portal/${slug}/entrar?t=${token}&r=${redirect}`,
    token,
  }
}
