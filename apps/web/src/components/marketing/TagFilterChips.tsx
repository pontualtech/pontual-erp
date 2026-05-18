'use client'

/**
 * TagFilterChips — filtro avançado por tags com 3 modos lógicos.
 *
 * Cada chip tem um mode:
 *  - 'and' (azul): deve ter essa tag (hasEvery no backend)
 *  - 'or'  (verde): pelo menos uma das 'or' tags (hasSome)
 *  - 'not' (vermelho): NÃO pode ter (NOT hasSome)
 *
 * Click no chip cicla mode (and → or → not → remove).
 *
 * Autocomplete consome /api/marketing/contatos/tags?prefix=... com debounce 150ms.
 * Sugestões mostram count entre parênteses pra dar contexto de relevância.
 */

import { useEffect, useRef, useState } from 'react'
import { X, Plus } from 'lucide-react'

export type TagMode = 'and' | 'or' | 'not'
export interface TagFilter {
  tag: string
  mode: TagMode
}

interface Props {
  value: TagFilter[]
  onChange: (next: TagFilter[]) => void
}

const MODE_CYCLE: Record<TagMode, TagMode | null> = {
  and: 'or',
  or: 'not',
  not: null, // null = remove chip
}

const MODE_LABEL: Record<TagMode, string> = {
  and: 'AND',
  or: 'OR',
  not: 'NOT',
}

const MODE_CLASSES: Record<TagMode, string> = {
  and: 'bg-blue-100 text-blue-700 ring-1 ring-blue-600/20 hover:bg-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/40 dark:hover:bg-blue-500/25',
  or: 'bg-green-100 text-green-700 ring-1 ring-green-600/20 hover:bg-green-200 dark:bg-green-500/15 dark:text-green-300 dark:ring-green-500/40 dark:hover:bg-green-500/25',
  not: 'bg-rose-100 text-rose-700 ring-1 ring-rose-600/20 hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/40 dark:hover:bg-rose-500/25',
}

export function TagFilterChips({ value, onChange }: Props) {
  const [inputOpen, setInputOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<{ tag: string; count: number }[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced fetch das sugestões
  useEffect(() => {
    if (!inputOpen) { setSuggestions([]); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/marketing/contatos/tags?prefix=${encodeURIComponent(query)}&limit=20`)
        if (r.ok) {
          const j = await r.json()
          const existing = new Set(value.map(v => v.tag))
          setSuggestions((j.data?.tags || []).filter((t: any) => !existing.has(t.tag)))
        }
      } finally { setLoading(false) }
    }, 150)
    return () => clearTimeout(t)
  }, [query, inputOpen, value])

  function addTag(tag: string) {
    if (!tag || value.some(v => v.tag === tag)) return
    onChange([...value, { tag, mode: 'and' }])
    setQuery('')
    // Mantém aberto pra adicionar várias em sequência
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function cycleMode(tag: string) {
    const filter = value.find(v => v.tag === tag)
    if (!filter) return
    const next = MODE_CYCLE[filter.mode]
    if (next === null) {
      onChange(value.filter(v => v.tag !== tag))
    } else {
      onChange(value.map(v => v.tag === tag ? { ...v, mode: next } : v))
    }
  }

  function removeTag(tag: string) {
    onChange(value.filter(v => v.tag !== tag))
  }

  function clearAll() {
    onChange([])
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map(f => (
        <span
          key={f.tag}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${MODE_CLASSES[f.mode]}`}
        >
          <button
            type="button"
            onClick={() => cycleMode(f.tag)}
            title={`Modo: ${MODE_LABEL[f.mode]} (clique pra ciclar AND→OR→NOT→remover)`}
            className="font-mono text-[10px] uppercase opacity-70 hover:opacity-100"
          >
            {MODE_LABEL[f.mode]}
          </button>
          <span className="font-normal">{f.tag}</span>
          <button
            type="button"
            onClick={() => removeTag(f.tag)}
            className="rounded-full p-0.5 opacity-50 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
            title="Remover"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      {/* Input pra adicionar */}
      {inputOpen ? (
        <div className="relative">
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onBlur={() => setTimeout(() => setInputOpen(false), 200)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setInputOpen(false); setQuery('') }
              if (e.key === 'Enter' && suggestions[0]) addTag(suggestions[0].tag)
              if (e.key === 'Enter' && !suggestions[0] && query.trim()) addTag(query.trim())
            }}
            placeholder="filtrar por tag…"
            className="w-40 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {(suggestions.length > 0 || loading) && (
            <div className="absolute top-full left-0 z-30 mt-1 min-w-[200px] rounded-md border border-gray-200 bg-white py-1 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800">
              {loading && <div className="px-3 py-1.5 text-gray-400">carregando…</div>}
              {!loading && suggestions.length === 0 && query.trim() && (
                <button
                  type="button"
                  onMouseDown={() => addTag(query.trim())}
                  className="block w-full px-3 py-1.5 text-left text-blue-600 hover:bg-gray-50 dark:text-blue-400 dark:hover:bg-gray-700"
                >
                  Adicionar tag custom "{query.trim()}"
                </button>
              )}
              {suggestions.slice(0, 12).map(s => (
                <button
                  key={s.tag}
                  type="button"
                  onMouseDown={() => addTag(s.tag)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <span className="font-medium text-gray-700 dark:text-gray-200">{s.tag}</span>
                  <span className="text-[10px] text-gray-400">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setInputOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-blue-400 hover:bg-gray-50 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <Plus className="h-3 w-3" /> Tag
        </button>
      )}

      {value.length > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="text-[11px] text-gray-400 hover:text-gray-600 hover:underline dark:hover:text-gray-200"
        >
          Limpar tags
        </button>
      )}
    </div>
  )
}

/**
 * Helper pra converter array TagFilter[] em query params (tags, tagsAny, tagsNot).
 * Use no componente pai pra montar URL da API.
 */
export function tagFiltersToParams(filters: TagFilter[]): { tags: string; tagsAny: string; tagsNot: string } {
  const out = { tags: '', tagsAny: '', tagsNot: '' }
  const groups: Record<TagMode, string[]> = { and: [], or: [], not: [] }
  filters.forEach(f => groups[f.mode].push(f.tag))
  out.tags = groups.and.join(',')
  out.tagsAny = groups.or.join(',')
  out.tagsNot = groups.not.join(',')
  return out
}
