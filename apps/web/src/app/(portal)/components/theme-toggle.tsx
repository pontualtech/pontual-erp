'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState, useRef } from 'react'

const THEMES = [
  { id: 'light', label: 'Claro', icon: '☀️', description: 'Tema claro padrão' },
  { id: 'dark', label: 'Escuro', icon: '🌙', description: 'Tema escuro' },
  { id: 'system', label: 'Sistema', icon: '💻', description: 'Seguir configuração do dispositivo' },
] as const

const COLOR_SCHEMES = [
  { id: 'blue', label: 'Azul', color: '#2563eb', tw: 'bg-blue-600' },
  { id: 'violet', label: 'Violeta', color: '#7c3aed', tw: 'bg-violet-600' },
  { id: 'emerald', label: 'Esmeralda', color: '#059669', tw: 'bg-emerald-600' },
  { id: 'rose', label: 'Rosa', color: '#e11d48', tw: 'bg-rose-600' },
  { id: 'amber', label: 'Âmbar', color: '#d97706', tw: 'bg-amber-600' },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [colorScheme, setColorScheme] = useState('blue')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem('portal_color_scheme')
    if (saved) setColorScheme(saved)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!mounted) return
    // Apply color scheme as CSS custom properties on :root
    const root = document.documentElement
    const scheme = COLOR_SCHEMES.find(s => s.id === colorScheme)
    if (scheme) {
      root.setAttribute('data-color-scheme', scheme.id)
      localStorage.setItem('portal_color_scheme', scheme.id)
    }
  }, [colorScheme, mounted])

  if (!mounted) return <div className="w-9 h-9" />

  const isDark = theme === 'dark'
  const currentTheme = THEMES.find(t => t.id === theme) || THEMES[2]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label="Configurações de tema"
        title="Configurações de tema"
      >
        {isDark ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-zinc-800 rounded-xl shadow-xl dark:shadow-zinc-900/50 border border-gray-200 dark:border-zinc-700 p-3 z-50 animate-in fade-in slide-in-from-top-2">
          {/* Theme Mode */}
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">Aparência</p>
          <div className="grid grid-cols-3 gap-1.5 mb-4">
            {THEMES.map(t => (
              <button
                type="button"
                key={t.id}
                onClick={() => {
                  setTheme(t.id)
                  try { const { portalEvents } = require('@/lib/analytics'); portalEvents.themeChanged?.(t.id) } catch {}
                }}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg text-xs font-medium transition-colors ${
                  theme === t.id
                    ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-700'
                }`}
                title={t.description}
              >
                <span className="text-lg">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Reset */}
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => {
                setTheme('system')
                setOpen(false)
              }}
              className="w-full text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
            >
              Restaurar padrao
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
