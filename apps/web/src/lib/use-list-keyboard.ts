'use client'

import { useEffect, useState } from 'react'

/**
 * UX-5 #5: hotkeys context-aware para listas (Gmail/Linear style).
 * j/k navega ↓/↑, Enter abre, e edita (callback opcional).
 *
 * Uso:
 *   const { activeIndex, setActiveIndex } = useListKeyboard({
 *     count: items.length,
 *     onEnter: (i) => router.push(`/os/${items[i].id}`),
 *     onEdit: (i) => router.push(`/os/${items[i].id}/editar`),
 *   })
 *   // marcar a linha ativa: items[activeIndex] tem highlight visual
 *
 * Bypass automático em <input>/<textarea>/<select>/contenteditable e
 * quando há modificador (Cmd/Ctrl/Alt) — não interfere com digitação.
 */
export function useListKeyboard({
  count,
  onEnter,
  onEdit,
  onEscape,
  enabled = true,
}: {
  count: number
  onEnter?: (index: number) => void
  onEdit?: (index: number) => void
  onEscape?: () => void
  enabled?: boolean
}) {
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  useEffect(() => {
    if (!enabled) return

    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (el.isContentEditable) return true
      return false
    }

    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          if (count === 0) return
          e.preventDefault()
          setActiveIndex((i) => Math.min(count - 1, (i < 0 ? 0 : i + 1)))
          break
        case 'k':
        case 'ArrowUp':
          if (count === 0) return
          e.preventDefault()
          setActiveIndex((i) => Math.max(0, i - 1))
          break
        case 'Enter':
          if (activeIndex >= 0 && activeIndex < count && onEnter) {
            e.preventDefault()
            onEnter(activeIndex)
          }
          break
        case 'e':
          if (activeIndex >= 0 && activeIndex < count && onEdit) {
            e.preventDefault()
            onEdit(activeIndex)
          }
          break
        case 'Escape':
          if (onEscape) {
            onEscape()
            return
          }
          setActiveIndex(-1)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count, activeIndex, onEnter, onEdit, onEscape, enabled])

  // Reset quando count diminui (filtro mudou)
  useEffect(() => {
    if (activeIndex >= count) setActiveIndex(-1)
  }, [count, activeIndex])

  return { activeIndex, setActiveIndex }
}
