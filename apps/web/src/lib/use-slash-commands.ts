'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * UX-8 #4: hook pra slash commands em textarea/input.
 * Detecta `/` no início de linha e abre popover de templates filtráveis.
 * Inserção: substitui o token "/xyz" pelo body do snippet selecionado.
 *
 * Uso:
 *   const { ref, popoverProps, ... } = useSlashCommands({
 *     onSelect: (snippet) => insertText(snippet.body),
 *   })
 *   <textarea ref={ref} ... />
 *   {popoverOpen && <Popover {...popoverProps} />}
 */
export type SlashSnippet = { key: string; title: string; body: string; category?: string }

const DEFAULT_SNIPPETS: SlashSnippet[] = [
  { key: 'aprovado_agendar', title: 'Aprovado — vou agendar', body: 'Olá! Seu orçamento foi aprovado. Vou agendar a entrega/coleta e te aviso o horário em breve.', category: 'orcamento' },
  { key: 'pix_enviado', title: 'PIX enviado', body: 'Boa tarde! Acabei de enviar o link PIX. Após o pagamento, é confirmado automaticamente em alguns segundos.', category: 'cobranca' },
  { key: 'boleto_enviado', title: 'Boleto enviado', body: 'Olá! Boleto enviado por email/WhatsApp. Vencimento conforme combinado. Avise se tiver alguma dificuldade.', category: 'cobranca' },
  { key: 'pronto_retirar', title: 'Equipamento pronto', body: 'Equipamento já está pronto para retirada! Funcionamento de seg a sex 8h-18h. Sábado 8h-12h.', category: 'entrega' },
  { key: 'aguardando_peca', title: 'Aguardando peça', body: 'Estamos aguardando a chegada da peça. Previsão: X dias úteis. Avisamos assim que chegar.', category: 'reparo' },
]

export function useSlashCommands(opts?: { snippets?: SlashSnippet[] }) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const snippets = opts?.snippets || DEFAULT_SNIPPETS

  const filtered = snippets.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase()) ||
    s.key.toLowerCase().includes(query.toLowerCase())
  )

  const closePopover = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
  }, [])

  const insertSnippet = useCallback((snippet: SlashSnippet) => {
    const el = ref.current
    if (!el) return
    const value = el.value
    const cursor = el.selectionStart ?? value.length
    // Procura o "/" antes do cursor que inicia o token
    let slashPos = -1
    for (let i = cursor - 1; i >= 0; i--) {
      const c = value[i]
      if (c === '/') { slashPos = i; break }
      if (c === ' ' || c === '\n') break
    }
    if (slashPos === -1) {
      // Sem slash detectado — apenas insere no cursor
      const newVal = value.slice(0, cursor) + snippet.body + value.slice(cursor)
      el.value = newVal
      el.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      const newVal = value.slice(0, slashPos) + snippet.body + value.slice(cursor)
      el.value = newVal
      el.dispatchEvent(new Event('input', { bubbles: true }))
      const newCursor = slashPos + snippet.body.length
      el.setSelectionRange(newCursor, newCursor)
    }
    el.focus()
    closePopover()
  }, [closePopover])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function onInput() {
      if (!el) return
      const value = el.value
      const cursor = el.selectionStart ?? value.length
      // Detecta "/" no início OU após espaço/newline, capturando token até cursor
      let slashPos = -1
      for (let i = cursor - 1; i >= 0; i--) {
        const c = value[i]
        if (c === '/') { slashPos = i; break }
        if (c === ' ' || c === '\n') break
      }
      if (slashPos === -1) {
        if (open) closePopover()
        return
      }
      // Slash precisa estar no início ou após whitespace
      const before = slashPos === 0 ? '' : value[slashPos - 1]
      if (before !== '' && before !== ' ' && before !== '\n') {
        if (open) closePopover()
        return
      }
      const token = value.slice(slashPos + 1, cursor)
      // Se tem espaço dentro do token, não é slash command
      if (token.includes(' ') || token.includes('\n')) {
        if (open) closePopover()
        return
      }
      setQuery(token)
      setOpen(true)
      setActiveIndex(0)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!open) return
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((i) => Math.max(0, i - 1))
          break
        case 'Enter':
        case 'Tab':
          if (filtered[activeIndex]) {
            e.preventDefault()
            insertSnippet(filtered[activeIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          closePopover()
          break
      }
    }

    el.addEventListener('input', onInput)
    el.addEventListener('keydown', onKeyDown as unknown as EventListener)
    return () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('keydown', onKeyDown as unknown as EventListener)
    }
  }, [open, activeIndex, filtered, insertSnippet, closePopover])

  return {
    ref,
    open,
    query,
    activeIndex,
    filtered,
    insertSnippet,
    closePopover,
  }
}
