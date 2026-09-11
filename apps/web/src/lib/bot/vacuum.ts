/**
 * Classificador do watchdog de vácuo dos bots (auditoria 11/09).
 *
 * Contexto: clientes ficavam sem NENHUMA resposta quando o callDify estourava
 * timeout (o catch antigo só deixava nota privada) ou quando o pipeline morria
 * por causa nova (reopen pós-resolved, lock, deploy). O watchdog varre o
 * Chatwoot a cada 10min e re-dispara o pipeline para conversas em vácuo; este
 * helper puro decide o destino de cada conversa a partir das mensagens.
 *
 * - 'vacuum'      — última pública é incoming há 5–120min sem resposta
 *                   substantiva (notas privadas e holdings não contam).
 * - 'answered'    — bot/agente respondeu depois do incoming.
 * - 'too_fresh'   — <5min: debounce/pipeline ainda pode estar processando.
 * - 'too_old'     — >120min: não reabrir conversa fria do nada.
 * - 'farewell'    — despedida curta ou mensagem sem texto (mídia): não
 *                   re-disparar (re-POST sintético não carrega attachments).
 * - 'no_incoming' — última pública é outgoing normal (ou sem mensagens).
 */
export type VacuumVerdict = 'vacuum' | 'answered' | 'too_fresh' | 'too_old' | 'farewell' | 'no_incoming'

export const MIN_AGE_SEC = 5 * 60
export const MAX_AGE_SEC = 120 * 60

// Prefixos das holdings que o bot envia quando Gemini falha — o watchdog
// enxerga ATRAVÉS delas (não são resposta de verdade).
export const HOLDING_MARKERS = [
  'Opa, tive uma instabilidade rapidinha',
  'Opa, deu uma travadinha aqui',
]

const FAREWELL_RE = /^(ok(ay)?\b|obrigad|valeu|at[eé](\s|[.!]|$)|tchau|beleza|blz\b|👍|🙏|😊|🥰|❤|show\b|perfeito[.!\s]*$|certo[.!\s]*$)/i

export function classifyVacuum(
  msgs: { type: 'incoming' | 'outgoing'; private?: boolean; content: string; created_at: number }[],
  nowSec: number,
): VacuumVerdict {
  const pub = msgs.filter(m => !m.private)
  // última incoming e o que veio depois dela
  let lastIncIdx = -1
  for (let i = pub.length - 1; i >= 0; i--) {
    if (pub[i].type === 'incoming') { lastIncIdx = i; break }
  }
  if (lastIncIdx === -1) return 'no_incoming'
  const lastInc = pub[lastIncIdx]

  const after = pub.slice(lastIncIdx + 1)
  const substantiva = after.some(m =>
    m.type === 'outgoing' && !HOLDING_MARKERS.some(h => (m.content || '').startsWith(h)),
  )
  if (substantiva) return 'answered'

  const content = (lastInc.content || '').trim()
  // sem texto (mídia/sticker) ou despedida curta: não re-disparar
  if (!content) return 'farewell'
  if (content.length <= 30 && FAREWELL_RE.test(content)) return 'farewell'

  const age = nowSec - lastInc.created_at
  if (age < MIN_AGE_SEC) return 'too_fresh'
  if (age > MAX_AGE_SEC) return 'too_old'
  return 'vacuum'
}
