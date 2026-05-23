'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * SlashCommandTextarea — Sprint UX-16 (2026-05-23)
 *
 * Textarea com autocomplete de templates ativado por "/" no início de linha.
 * Inspirado em Notion slash commands.
 *
 * Templates persistem em localStorage por usuário (key: slash_templates_{key}).
 * Cada template tem nome curto + conteúdo inserido.
 *
 * Uso típico: laudos técnicos repetitivos (cabeça de impressão Epson trocada,
 * limpeza completa, etc).
 *
 * Props identicas a <textarea> + `templateKey` (default 'laudo') que isola
 * templates por contexto (laudo, observação interna, etc).
 */

interface Template {
  name: string
  description?: string
  content: string
}

const DEFAULT_TEMPLATES_LAUDO: Template[] = [
  {
    name: 'cabeca',
    description: 'Cabeça de impressão trocada',
    content: 'Substituída a cabeça de impressão por nova original do fabricante. Equipamento testado, todas as cores imprimindo corretamente, alinhamento de cores efetuado. Garantia de 90 dias na peça e no serviço conforme CDC.',
  },
  {
    name: 'limpeza',
    description: 'Limpeza completa do sistema',
    content: 'Realizada limpeza completa do sistema de impressão: cabeça, encoder, sensor de papel, rolamento de tracionamento. Substituídos absorventes de tinta. Equipamento testado e aprovado.',
  },
  {
    name: 'fusor',
    description: 'Fusor substituído',
    content: 'Substituído o conjunto fusor por unidade nova original. Counter zerado. Equipamento testado com impressões de teste, qualidade conferida.',
  },
  {
    name: 'drum',
    description: 'Cilindro (drum) substituído',
    content: 'Substituído o cilindro/drum por nova unidade original. Counter resetado. Limpeza geral do sistema realizada. Testado e aprovado.',
  },
  {
    name: 'tinta',
    description: 'Reabastecimento sistema bulk',
    content: 'Reabastecido o sistema de tinta (bulk/tanque). Realizada purga das mangueiras + cabeça. Alinhamento e teste de cores conferido.',
  },
  {
    name: 'pecas',
    description: 'Aguardando peça do fornecedor',
    content: 'Diagnóstico concluído. Aguardando chegada de peça do fornecedor — previsão de 5-7 dias úteis. Cliente informado.',
  },
  {
    name: 'orcamento',
    description: 'Orçamento recusado',
    content: 'Cliente recusou orçamento. Equipamento será devolvido sem reparo conforme acordo.',
  },
  {
    name: 'recibo',
    description: 'Equipamento recebido sem defeito constatado',
    content: 'Equipamento recebido para análise. Foi efetuado check-list completo de funcionamento e nenhum defeito foi constatado. Devolvido sem reparo conforme acordo.',
  },
]

interface Props extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  templateKey?: string
  defaults?: Template[]
}

export function SlashCommandTextarea({ templateKey = 'laudo', defaults = DEFAULT_TEMPLATES_LAUDO, value, onChange, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [filter, setFilter] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [templates, setTemplates] = useState<Template[]>(defaults)
  const [slashStartPos, setSlashStartPos] = useState<number | null>(null)

  // Carrega user templates do localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = localStorage.getItem(`slash_templates_${templateKey}`)
      if (stored) {
        const custom: Template[] = JSON.parse(stored)
        // user templates primeiro, depois defaults (dedup por nome)
        const allNames = new Set(custom.map(t => t.name))
        setTemplates([...custom, ...defaults.filter(d => !allNames.has(d.name))])
      }
    } catch {}
  }, [templateKey, defaults])

  // Detecta digitação de "/" no início de linha
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const cur = e.target.value
    const pos = e.target.selectionStart
    onChange?.(e)

    // Verifica se o caractere atual é "/" e está no início ou após uma linha
    if (pos > 0 && cur[pos - 1] === '/') {
      const prevChar = pos >= 2 ? cur[pos - 2] : ''
      const isAtLineStart = pos === 1 || prevChar === '\n'
      if (isAtLineStart) {
        setSlashStartPos(pos - 1)
        setShowMenu(true)
        setFilter('')
        setActiveIdx(0)
        return
      }
    }

    // Se menu está aberto, atualiza filtro
    if (showMenu && slashStartPos !== null) {
      if (pos < slashStartPos || cur[slashStartPos] !== '/') {
        // Slash sumiu — fecha menu
        setShowMenu(false)
        setSlashStartPos(null)
      } else {
        const newFilter = cur.substring(slashStartPos + 1, pos).toLowerCase()
        setFilter(newFilter)
        setActiveIdx(0)
      }
    }
  }

  const filtered = templates.filter(t =>
    !filter || t.name.toLowerCase().includes(filter) || (t.description || '').toLowerCase().includes(filter)
  )

  function applyTemplate(t: Template) {
    if (!ref.current || slashStartPos === null) return
    const cur = ref.current.value
    const endPos = ref.current.selectionStart
    const before = cur.substring(0, slashStartPos)
    const after = cur.substring(endPos)
    const next = before + t.content + after
    // Fire onChange sintético
    const newPos = before.length + t.content.length
    const fake = { target: { value: next, selectionStart: newPos } } as any
    onChange?.(fake)
    setShowMenu(false)
    setSlashStartPos(null)
    // Refoca + reposiciona cursor
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus()
        ref.current.setSelectionRange(newPos, newPos)
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showMenu) return
    if (e.key === 'Escape') {
      e.preventDefault()
      setShowMenu(false)
      setSlashStartPos(null)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(filtered.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (filtered[activeIdx]) {
        e.preventDefault()
        applyTemplate(filtered[activeIdx])
      }
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowMenu(false), 150)}
        {...rest}
      />

      {showMenu && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 left-2 max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-b dark:border-gray-700">
            Templates {filter && `· "${filter}"`}
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {filtered.map((t, i) => (
              <li key={t.name}>
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); applyTemplate(t) }}
                  className={`w-full text-left px-3 py-2 text-sm ${
                    i === activeIdx
                      ? 'bg-blue-50 dark:bg-blue-950'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-blue-600 dark:text-blue-400">/{t.name}</span>
                    {t.description && (
                      <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{t.description}</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-[10px] text-gray-500 border-t dark:border-gray-700">
            ↑↓ navegar · Enter usar · Esc fechar
          </div>
        </div>
      )}
    </div>
  )
}
