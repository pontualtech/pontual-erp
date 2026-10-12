/**
 * Quando o bot pode "adivinhar" o clique de anúncio de uma conversa (fingerprint) — 12/10/2026.
 *
 * Auditoria de 10/10: o fingerprint (chatwoot/bot) só olhava a cópia volátil `data.attribution`,
 * que o bot zera a cada turno — então reatribuía conversas EM ANDAMENTO com o clique mais recente
 * de outra pessoa (1.209 conversas consumiram mais de 1 clique; 227 OS com gclid trocado). Também
 * rodava no Suporte (nenhum botão do site leva lá) e gravava gclid mesmo com vários cliques
 * possíveis na janela. Isso ensinava o Google errado (vendas/leads com clique de terceiro).
 */
export const NEW_CONVERSATION_MAX_AGE_MS = 2 * 60 * 1000

export function shouldRunFingerprint(input: {
  isWhatsappChannel: boolean
  isSupportBot: boolean
  /** Origem já gravada na coluna durável `attribution` OU na cópia legada `data.attribution`. */
  hasAttribution: boolean
  /** created_at da linha em bot_conversations (null = conversa ainda sem linha = nova). */
  conversationCreatedAt: Date | null
  now: Date
}): boolean {
  if (!input.isWhatsappChannel || input.isSupportBot || input.hasAttribution) return false
  if (!input.conversationCreatedAt) return true
  return input.now.getTime() - input.conversationCreatedAt.getTime() <= NEW_CONVERSATION_MAX_AGE_MS
}

const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'li_fat_id', 'twclid', 'ttclid'] as const

/**
 * Com 1 só clique livre na janela ('exact') o clique é guardado inteiro. Com vários ('channel')
 * o canal está certo mas o clique pode ser de outra pessoa: guarda só a origem (utm/canal, que
 * alimenta canal_entrada e relatórios) e descarta os IDs de clique, que iriam para o Google.
 */
export function attributionForPrecision<T extends Record<string, string>>(attribution: T, precision: 'exact' | 'channel'): Partial<T> {
  if (precision === 'exact') return attribution
  const out: Record<string, string> = { ...attribution }
  for (const k of CLICK_ID_KEYS) delete out[k]
  return out as Partial<T>
}
