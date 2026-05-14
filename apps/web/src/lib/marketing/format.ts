/**
 * Formatadores consistentes pra exibição de dados de marketing.
 *
 * Princípios:
 * - Datas sempre relativas ("há 2h") com tooltip de data exata
 * - Números em pt-BR sempre (locale fixo)
 * - Null/undefined retornam "—" (em-dash, evita "null" ou "undefined" na UI)
 */

const DASH = '—'

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return DASH
  return n.toLocaleString('pt-BR')
}

export function formatPercent(value: number, total: number, decimals = 1): string {
  if (!total || total === 0) return DASH
  return ((value / total) * 100).toFixed(decimals) + '%'
}

export function formatDateAbsolute(input: string | Date | null | undefined): string {
  if (!input) return DASH
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function formatDateShort(input: string | Date | null | undefined): string {
  if (!input) return DASH
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleDateString('pt-BR')
}

/**
 * Data relativa em pt-BR: "agora", "há 5min", "há 2h", "há 3d", "há 2 sem"
 * Datas mais antigas que 30 dias mostram data absoluta curta (13/05/2024).
 */
export function formatRelative(input: string | Date | null | undefined): string {
  if (!input) return DASH
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return DASH

  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 0) return formatDateShort(d) // futuro
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin}min`

  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH}h`

  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `há ${diffD}d`
  if (diffD < 30) return `há ${Math.floor(diffD / 7)} sem`

  return formatDateShort(d)
}

/**
 * Iniciais pra avatar (max 2 chars).
 * "João Silva" → "JS"
 * "ana@email.com" → "A" (fallback pro email se não há nome)
 */
export function initials(name?: string | null, fallback?: string | null): string {
  const source = (name || fallback || '?').trim()
  if (!source) return '?'
  const parts = source.split(/\s+|@/).filter(Boolean)
  if (parts.length === 0) return source.charAt(0).toUpperCase()
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/**
 * Cor determinística pra avatar baseada em string (hash simples).
 * Mesmo email sempre gera mesma cor.
 */
export function avatarColor(seed: string): string {
  const colors = [
    'bg-blue-500',   'bg-purple-500', 'bg-pink-500',  'bg-rose-500',
    'bg-orange-500', 'bg-amber-500',  'bg-teal-500',  'bg-emerald-500',
    'bg-cyan-500',   'bg-indigo-500', 'bg-violet-500','bg-fuchsia-500',
  ]
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}
