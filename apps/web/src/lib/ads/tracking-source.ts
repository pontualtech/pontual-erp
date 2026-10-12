/**
 * De onde veio o gclid gravado na OS (12/10/2026) — o portão de vendas (lib/ads/click-match)
 * precisa saber. O formulário do site (pontualtech.com.br, origem 'site-pontualtech') manda o
 * gclid do cookie do próprio navegador: prova de 1ª mão. Já o tracking recuperado da conversa
 * do bot pode ter vindo do "fingerprint" (clique de outra pessoa).
 */
export type TrackingSource = 'site_form' | 'request_body' | 'bot_conversation'

export function trackingSourceFor(input: { bodyHadTracking: boolean; origem?: string | null }): TrackingSource {
  if (!input.bodyHadTracking) return 'bot_conversation'
  return input.origem === 'site-pontualtech' ? 'site_form' : 'request_body'
}
