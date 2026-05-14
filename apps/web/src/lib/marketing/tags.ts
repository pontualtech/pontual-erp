/**
 * Humanização de tags do marketing_contacts.
 *
 * Backend usa IDs técnicos (`stage:cliente_atendido`); UI mostra labels humanos.
 * Single source of truth — se mudar nome aqui, muda em todas as 5 páginas.
 */

export type TagKind = 'stage' | 'segment' | 'origin' | 'service' | 'year' | 'email' | 'other'
export type TagColor = 'green' | 'blue' | 'amber' | 'orange' | 'gray' | 'purple' | 'violet' | 'rose' | 'red'

export interface TagDescriptor {
  /** Tag técnica original (ex: "stage:cliente_atendido") */
  raw: string
  /** Tipo (stage/segment/etc) — pra agrupamento e prioridade visual */
  kind: TagKind
  /** Label humano (ex: "Cliente atendido") */
  label: string
  /** Cor semântica do badge */
  color: TagColor
  /** Emoji opcional (string vazia se sem emoji) */
  emoji: string
  /** Se true, NÃO renderiza na UI (tags sempre verdadeiras pra empresa, ex: service:impressora) */
  hidden: boolean
}

// Mapeamento explícito das tags conhecidas.
// Tags desconhecidas caem no fallback genérico.
const STAGE_MAP: Record<string, Omit<TagDescriptor, 'raw' | 'kind' | 'hidden'>> = {
  cliente_atendido:     { label: 'Cliente atendido',       color: 'green', emoji: '✅' },
  cliente_em_servico:   { label: 'Em serviço',             color: 'blue',  emoji: '🔧' },
  lead_aguardando:      { label: 'Aguardando aprovação',   color: 'amber', emoji: '⏳' },
  em_negociacao:        { label: 'Em negociação',          color: 'orange', emoji: '💬' },
  perdido_recusou:      { label: 'Perdido',                color: 'gray',  emoji: '✕' },
}

const SEGMENT_MAP: Record<string, Omit<TagDescriptor, 'raw' | 'kind' | 'hidden'>> = {
  b2c: { label: 'Pessoa física', color: 'purple', emoji: '👤' },
  b2b: { label: 'Empresa',       color: 'violet', emoji: '🏢' },
  desconhecido: { label: 'Segmento desconhecido', color: 'gray', emoji: '❓' },
}

const ORIGIN_MAP: Record<string, Omit<TagDescriptor, 'raw' | 'kind' | 'hidden'>> = {
  erp_auto:      { label: 'Auto via ERP',     color: 'gray', emoji: '' },
  vhsys_import:  { label: 'Histórico VHSys',  color: 'gray', emoji: '📦' },
  manual:        { label: 'Manual',           color: 'gray', emoji: '✍️' },
  mautic_import: { label: 'Import Mautic',    color: 'gray', emoji: '📥' },
}

const ALWAYS_HIDDEN_PREFIXES = ['service:', 'has_customer_link']

/**
 * Parse uma tag técnica em descritor humano.
 *
 * @example
 * humanizeTag('stage:cliente_atendido')
 * // { raw: '...', kind: 'stage', label: 'Cliente atendido', color: 'green', emoji: '✅', hidden: false }
 */
export function humanizeTag(raw: string): TagDescriptor {
  // Tags sempre ocultas
  if (ALWAYS_HIDDEN_PREFIXES.some(p => raw.startsWith(p) || raw === p)) {
    return { raw, kind: 'other', label: raw, color: 'gray', emoji: '', hidden: true }
  }

  const colonIdx = raw.indexOf(':')
  if (colonIdx === -1) {
    return { raw, kind: 'other', label: raw, color: 'gray', emoji: '', hidden: false }
  }

  const prefix = raw.slice(0, colonIdx)
  const value = raw.slice(colonIdx + 1)

  switch (prefix) {
    case 'stage': {
      const m = STAGE_MAP[value]
      if (m) return { raw, kind: 'stage', ...m, hidden: false }
      return { raw, kind: 'stage', label: value, color: 'gray', emoji: '', hidden: false }
    }
    case 'segment': {
      const m = SEGMENT_MAP[value]
      if (m) return { raw, kind: 'segment', ...m, hidden: false }
      return { raw, kind: 'segment', label: value, color: 'purple', emoji: '', hidden: false }
    }
    case 'origin': {
      const m = ORIGIN_MAP[value]
      if (m) return { raw, kind: 'origin', ...m, hidden: false }
      return { raw, kind: 'origin', label: value, color: 'gray', emoji: '', hidden: false }
    }
    case 'year':
      return { raw, kind: 'year', label: value, color: 'gray', emoji: '', hidden: false }
    case 'email':
      return { raw, kind: 'email', label: value, color: 'blue', emoji: '📧', hidden: false }
    case 'service':
      // Pra PT é sempre impressora — esconde do default
      return { raw, kind: 'service', label: value, color: 'gray', emoji: '', hidden: true }
    default:
      return { raw, kind: 'other', label: raw, color: 'gray', emoji: '', hidden: false }
  }
}

/**
 * Humaniza array de tags + filtra ocultas + ordena por prioridade visual
 * (stage > segment > origin > year > others).
 */
export function humanizeTags(rawTags: string[]): TagDescriptor[] {
  const kindOrder: Record<TagKind, number> = {
    stage: 0, segment: 1, origin: 2, year: 3, email: 4, service: 5, other: 6,
  }
  return rawTags
    .map(humanizeTag)
    .filter(t => !t.hidden)
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind])
}

/**
 * Classes Tailwind por cor (light + dark).
 * Manter aqui pra consistência em todos os componentes que usam TagBadge.
 */
export function tagColorClasses(color: TagColor): string {
  switch (color) {
    case 'green':  return 'bg-green-50 text-green-700 ring-1 ring-green-600/20 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/30'
    case 'blue':   return 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30'
    case 'amber':  return 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30'
    case 'orange': return 'bg-orange-50 text-orange-700 ring-1 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30'
    case 'purple': return 'bg-purple-50 text-purple-700 ring-1 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-300 dark:ring-purple-500/30'
    case 'violet': return 'bg-violet-50 text-violet-700 ring-1 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30'
    case 'rose':   return 'bg-rose-50 text-rose-700 ring-1 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30'
    case 'red':    return 'bg-red-50 text-red-700 ring-1 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'
    case 'gray':
    default:       return 'bg-gray-100 text-gray-700 ring-1 ring-gray-500/20 dark:bg-gray-700/40 dark:text-gray-300 dark:ring-gray-500/30'
  }
}
