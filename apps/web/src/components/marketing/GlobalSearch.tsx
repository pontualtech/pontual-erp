'use client'

/**
 * GlobalSearch — Cmd+K spotlight para o módulo Marketing.
 *
 * Comportamento:
 * - Cmd+K (macOS) ou Ctrl+K (Win/Linux) abre o modal de qualquer página
 * - Esc fecha
 * - ↑/↓ navegam pela lista, Enter abre o item focado
 * - Debounce 200ms na busca (evita request por tecla)
 * - Min 2 caracteres pra pesquisar
 * - Resultados agrupados por tipo (Contatos / Segmentos / Campanhas / Automações)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, User, FileText, Megaphone, Zap, Loader2 } from 'lucide-react'

interface ResultItem {
  id: string
  label: string
  sublabel?: string
  href: string
  icon: string
}

interface SearchResults {
  contacts: ResultItem[]
  segments: ResultItem[]
  campaigns: ResultItem[]
  automations: ResultItem[]
  total: number
}

const EMPTY: SearchResults = { contacts: [], segments: [], campaigns: [], automations: [], total: 0 }

const ICON_MAP: Record<string, any> = {
  user: User,
  'file-text': FileText,
  megaphone: Megaphone,
  zap: Zap,
}

const GROUP_LABELS: Record<keyof Omit<SearchResults, 'total'>, string> = {
  contacts: 'Contatos',
  segments: 'Segmentos',
  campaigns: 'Campanhas',
  automations: 'Automações',
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Keyboard shortcut: Cmd+K / Ctrl+K abre, Esc fecha
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // Foca input ao abrir
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setFocused(0)
    } else {
      setQuery('')
      setResults(EMPTY)
    }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(EMPTY)
      setLoading(false)
      return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/marketing/search?q=${encodeURIComponent(query.trim())}`)
        if (r.ok) setResults(((await r.json())?.data || EMPTY))
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  // Flatten pra navegação por teclado
  const flat: ResultItem[] = [
    ...results.contacts,
    ...results.segments,
    ...results.campaigns,
    ...results.automations,
  ]

  const navigate = useCallback((item: ResultItem) => {
    setOpen(false)
    router.push(item.href)
  }, [router])

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocused(f => Math.min(flat.length - 1, f + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocused(f => Math.max(0, f - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flat[focused]) navigate(flat[focused])
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        title="Buscar (Ctrl+K)"
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">Buscar…</span>
        <kbd className="hidden md:inline-flex items-center rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs font-mono text-gray-500 dark:border-gray-600 dark:bg-gray-900">
          Ctrl K
        </kbd>
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar contatos, segmentos, campanhas, automações…"
            className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
          />
          {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />}
          <button
            onClick={() => setOpen(false)}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {query.trim().length < 2 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Digite ao menos 2 caracteres pra pesquisar
            </div>
          ) : results.total === 0 && !loading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Nada encontrado pra "{query}"
            </div>
          ) : (
            <ResultGroups results={results} focused={focused} onSelect={navigate} flat={flat} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800/50">
          <span>
            <kbd className="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono dark:border-gray-600 dark:bg-gray-700">↑↓</kbd>{' '}
            navegar
            <span className="mx-2">·</span>
            <kbd className="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono dark:border-gray-600 dark:bg-gray-700">↵</kbd>{' '}
            abrir
            <span className="mx-2">·</span>
            <kbd className="rounded border border-gray-300 bg-white px-1 py-0.5 font-mono dark:border-gray-600 dark:bg-gray-700">Esc</kbd>{' '}
            fechar
          </span>
          {results.total > 0 && <span>{results.total} resultados</span>}
        </div>
      </div>
    </div>
  )
}

function ResultGroups({
  results,
  focused,
  onSelect,
  flat,
}: {
  results: SearchResults
  focused: number
  onSelect: (item: ResultItem) => void
  flat: ResultItem[]
}) {
  const groups: (keyof Omit<SearchResults, 'total'>)[] = ['contacts', 'segments', 'campaigns', 'automations']
  return (
    <div className="py-2">
      {groups.map(g => {
        const items = results[g]
        if (items.length === 0) return null
        return (
          <div key={g} className="mb-2">
            <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {GROUP_LABELS[g]}
            </div>
            {items.map(item => {
              const idx = flat.indexOf(item)
              const isFocused = idx === focused
              const Icon = ICON_MAP[item.icon] || Search
              return (
                <button
                  key={`${g}-${item.id}`}
                  onClick={() => onSelect(item)}
                  onMouseEnter={() => { /* no-op, focus by arrow keys */ }}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left transition ${
                    isFocused
                      ? 'bg-blue-50 dark:bg-blue-500/15'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isFocused ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {item.label}
                    </div>
                    {item.sublabel && (
                      <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                        {item.sublabel}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
