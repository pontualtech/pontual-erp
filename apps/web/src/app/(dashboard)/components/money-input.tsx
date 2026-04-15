'use client'

import { useState, useEffect, useRef, type InputHTMLAttributes } from 'react'

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Value in REAIS (e.g. 15.50), not cents */
  value: number | string
  /** Called with value in REAIS (e.g. 15.50) */
  onChange: (value: number) => void
  /** Show R$ prefix (default true) */
  showPrefix?: boolean
  /** Step for up/down arrows in REAIS (default 10) */
  step?: number
  /** Show up/down spinner arrows (default true) */
  showStepper?: boolean
}

/**
 * Brazilian money input with automatic formatting.
 * User types digits and the mask formats as R$ 1.234,56 in real time.
 * Internally works with reais (float), displays formatted.
 */
export function MoneyInput({ value, onChange, showPrefix = true, step = 10, showStepper = true, className = '', ...props }: MoneyInputProps) {
  const [display, setDisplay] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isTyping = useRef(false)

  // Format cents integer to display string (1234 → "12,34")
  function formatCents(cents: number): string {
    if (cents === 0) return '0,00'
    const str = String(Math.abs(Math.round(cents))).padStart(3, '0')
    const decimals = str.slice(-2)
    const intPart = str.slice(0, -2)
    // Add thousand separators
    const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return `${withSep},${decimals}`
  }

  // Parse reais value to cents
  function reaisToCents(reais: number | string): number {
    const num = typeof reais === 'string' ? parseFloat(reais) || 0 : reais
    return Math.round(num * 100)
  }

  // Sync external value → display (only when not actively typing)
  useEffect(() => {
    if (isTyping.current) return
    const cents = reaisToCents(value)
    setDisplay(formatCents(cents))
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    isTyping.current = true
    const raw = e.target.value.replace(/\D/g, '') // Only digits
    const cents = parseInt(raw) || 0
    setDisplay(formatCents(cents))
    onChange(cents / 100) // Return reais
  }

  function handleFocus() {
    isTyping.current = true
    // Select all on focus for easy replacement
    setTimeout(() => inputRef.current?.select(), 10)
  }

  function handleBlur() {
    isTyping.current = false
    const cents = reaisToCents(value)
    setDisplay(formatCents(cents))
  }

  function increment() {
    isTyping.current = false
    const current = typeof value === 'string' ? parseFloat(value) || 0 : value
    const next = Math.round((current + step) * 100) / 100
    setDisplay(formatCents(Math.round(next * 100)))
    onChange(next)
  }

  function decrement() {
    isTyping.current = false
    const current = typeof value === 'string' ? parseFloat(value) || 0 : value
    const next = Math.round(Math.max(0, current - step) * 100) / 100
    setDisplay(formatCents(Math.round(next * 100)))
    onChange(next)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowUp') { e.preventDefault(); increment() }
    if (e.key === 'ArrowDown') { e.preventDefault(); decrement() }
  }

  return (
    <div className={`relative flex items-center ${className}`}>
      {showPrefix && (
        <span className="absolute left-2.5 text-sm text-gray-400 dark:text-gray-500 pointer-events-none select-none font-medium z-10">
          R$
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-right text-sm font-medium text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${showPrefix ? 'pl-9' : 'pl-3'} ${showStepper ? 'pr-7' : 'pr-3'} py-2`}
        {...props}
      />
      {showStepper && (
        <div className="absolute right-0.5 inset-y-0.5 flex flex-col w-5">
          <button type="button" tabIndex={-1} onClick={increment} title="Aumentar"
            className="flex-1 flex items-center justify-center rounded-tr-md hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 3L10 8H2z"/></svg>
          </button>
          <button type="button" tabIndex={-1} onClick={decrement} title="Diminuir"
            className="flex-1 flex items-center justify-center rounded-br-md hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 9L2 4h8z"/></svg>
          </button>
        </div>
      )}
    </div>
  )
}
