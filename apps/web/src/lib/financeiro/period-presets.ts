// Period presets pro filtro de período do dashboard financeiro.
// ISO YYYY-MM-DD em UTC pra evitar timezone-shift cliente/servidor.

export type PeriodPreset = 'today' | '7d' | '30d' | 'month' | 'quarter' | 'year' | 'custom'

export interface PeriodRange {
  from: string // ISO YYYY-MM-DD
  to: string   // ISO YYYY-MM-DD
  label: string
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function rangeForPreset(preset: PeriodPreset, customFrom?: string, customTo?: string): PeriodRange {
  const now = new Date()
  const todayISO = iso(now)
  switch (preset) {
    case 'today':
      return { from: todayISO, to: todayISO, label: 'Hoje' }
    case '7d': {
      const from = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
      return { from: iso(from), to: todayISO, label: 'Últimos 7 dias' }
    }
    case '30d': {
      const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
      return { from: iso(from), to: todayISO, label: 'Últimos 30 dias' }
    }
    case 'month': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      return { from: iso(from), to: todayISO, label: monthLabel(now) }
    }
    case 'quarter': {
      const q = Math.floor(now.getUTCMonth() / 3)
      const from = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1))
      return { from: iso(from), to: todayISO, label: `${q + 1}º Trimestre ${now.getUTCFullYear()}` }
    }
    case 'year': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
      return { from: iso(from), to: todayISO, label: String(now.getUTCFullYear()) }
    }
    case 'custom': {
      const from = customFrom || todayISO
      const to = customTo || todayISO
      return { from, to, label: `${formatBR(from)} – ${formatBR(to)}` }
    }
  }
}

export function detectPreset(from: string, to: string): PeriodPreset {
  const today = iso(new Date())
  if (from === today && to === today) return 'today'
  for (const p of ['7d', '30d', 'month', 'quarter', 'year'] as PeriodPreset[]) {
    const r = rangeForPreset(p)
    if (r.from === from && r.to === to) return p
  }
  return 'custom'
}

export const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'year', label: 'Ano' },
]

function monthLabel(d: Date): string {
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .replace(/^\w/, (c) => c.toUpperCase())
}

export function formatBR(iso: string): string {
  if (!iso || iso.length < 10) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
