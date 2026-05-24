'use client'

import { useEffect, useState } from 'react'

/**
 * Wave AD (2026-05-24): substituto do <input type="date"> HTML5.
 *
 * Bug raiz: input type=date em locale pt-BR mostra placeholder "dd/mm/aaaa"
 * mas o browser NÃO aceita usuário digitar "21/04/2026" via teclado direto —
 * só aceita interação com calendário gráfico OU formato ISO yyyy-mm-dd via JS.
 * Karlão tentou digitar, viu o campo "vazio" e achou que o filtro estava broken.
 *
 * Este componente:
 *  - Renderiza input text controlado com placeholder dd/mm/aaaa
 *  - Aplica máscara automática (insere "/" enquanto digita)
 *  - Aceita digitar dia, mes, ano em sequência
 *  - Valida e emite onChange com formato ISO yyyy-mm-dd (compatível com value antigo)
 *  - Mantém value em formato ISO (vindo de fora) e exibe em dd/mm/yyyy
 */

interface Props {
  value: string  // formato ISO yyyy-mm-dd (mesmo que <input type="date">)
  onChange: (iso: string) => void
  title?: string
  id?: string
  className?: string
  placeholder?: string
}

function isoToBR(iso: string): string {
  if (!iso || iso.length < 10) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return ''
  return `${d}/${m}/${y}`
}

function brToIso(br: string): string {
  // expects dd/mm/yyyy completo
  const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return ''
  const [, d, mo, y] = m
  // valida limites básicos
  const day = parseInt(d, 10)
  const mon = parseInt(mo, 10)
  const yr = parseInt(y, 10)
  if (day < 1 || day > 31 || mon < 1 || mon > 12 || yr < 1900 || yr > 2999) return ''
  return `${y}-${mo}-${d}`
}

function maskBR(raw: string): string {
  // só dígitos, max 8
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

export function DateInputBR({ value, onChange, title, id, className, placeholder = 'dd/mm/aaaa' }: Props) {
  const [text, setText] = useState(() => isoToBR(value))

  // Sync com value externo (ex: clearFilters reseta state)
  useEffect(() => {
    setText(isoToBR(value))
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = maskBR(e.target.value)
    setText(masked)
    // Só emite onChange quando data completa e válida — evita re-render N vezes durante digitação parcial
    if (masked.length === 10) {
      const iso = brToIso(masked)
      if (iso) onChange(iso)
    } else if (masked.length === 0) {
      onChange('')  // permite limpar
    }
  }

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      title={title}
      placeholder={placeholder}
      value={text}
      onChange={handleChange}
      maxLength={10}
      className={className}
    />
  )
}
