/**
 * Quando o bot pode "adivinhar" o clique de anúncio de uma conversa (fingerprint) — 12/10/2026.
 *
 * Auditoria de 10/10: o fingerprint (chatwoot/bot) só olhava a cópia volátil `data.attribution`,
 * que o bot zera a cada turno — então reatribuía conversas EM ANDAMENTO com o clique mais recente
 * de outra pessoa (1.209 conversas consumiram mais de 1 clique; 227 OS com gclid trocado). Também
 * rodava no Suporte (nenhum botão do site leva lá) e gravava gclid mesmo com vários cliques
 * possíveis na janela. Isso ensinava o Google errado (vendas/leads com clique de terceiro).
 */
export function shouldRunFingerprint(input: {
  isWhatsappChannel: boolean
  isSupportBot: boolean
  /** Origem já gravada na coluna durável `attribution` OU na cópia legada `data.attribution`. */
  hasAttribution: boolean
  /**
   * A conversa já tem linha em bot_conversations? A linha só nasce depois da 1ª mensagem, então
   * linha existente = mensagem 2 em diante — e um clique livre agora é posterior ao início da
   * conversa: por definição não é dela.
   */
  conversationExists: boolean
}): boolean {
  return input.isWhatsappChannel && !input.isSupportBot && !input.hasAttribution && !input.conversationExists
}

const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'li_fat_id', 'twclid', 'ttclid'] as const
const CHANNEL_UTM: Record<string, { utm_source: string; utm_medium: string }> = {
  google_ads: { utm_source: 'google', utm_medium: 'cpc' },
  microsoft_ads: { utm_source: 'bing', utm_medium: 'cpc' },
  meta_ads: { utm_source: 'facebook', utm_medium: 'paid' },
  linkedin_ads: { utm_source: 'linkedin', utm_medium: 'paid' },
  x_ads: { utm_source: 'twitter', utm_medium: 'paid' },
  tiktok_ads: { utm_source: 'tiktok', utm_medium: 'paid' },
}

/**
 * Com 1 só clique livre na janela ('exact') o clique é guardado inteiro. Com vários ('channel')
 * o canal está certo mas o clique pode ser de outra pessoa: descarta os IDs de clique (iriam ao
 * Google) e garante utm de canal (anúncio só com auto-tagging não tem utm — sem isso o canal
 * sumia de canal_entrada e dos relatórios).
 */
export function attributionForPrecision(
  attribution: Record<string, string>,
  precision: 'exact' | 'channel',
  channel?: string,
): Record<string, string> {
  if (precision === 'exact') return attribution
  const out: Record<string, string> = { ...attribution }
  for (const k of CLICK_ID_KEYS) delete out[k]
  const utm = channel ? CHANNEL_UTM[channel] : undefined
  if (utm) {
    out.utm_source = out.utm_source || utm.utm_source
    out.utm_medium = out.utm_medium || utm.utm_medium
  }
  return out
}
