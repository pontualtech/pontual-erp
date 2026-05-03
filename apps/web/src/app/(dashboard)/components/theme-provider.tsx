'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/use-auth'

/**
 * UX-12 followup: theme-provider antes chamava /api/settings sem checar
 * permissão — atendente sem `config.view` disparava 403 em toda navegação.
 * Agora: cacheia tema no localStorage + só fetcha /api/settings se tem
 * permissão. Fallback para localStorage cobre o caso sem permissão.
 */
const THEME_CACHE_KEY = 'erp:theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, hasPermission } = useAuth()
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    try {
      const cached = localStorage.getItem(THEME_CACHE_KEY)
      return cached === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  useEffect(() => {
    // Só fetch se user tem permissão de ler settings — evita 403 spam
    if (!user) return
    const canViewSettings = isAdmin || hasPermission('config', 'view')
    if (!canViewSettings) return

    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        const data = d.data || {}
        for (const group of Object.values(data) as any[]) {
          for (const [key, val] of Object.entries(group)) {
            if (key === 'aparencia.tema') {
              const v = (val as any)?.value === 'dark' ? 'dark' : 'light'
              setTheme(v)
              try { localStorage.setItem(THEME_CACHE_KEY, v) } catch {}
            }
          }
        }
      })
      .catch(() => {})
  }, [user, isAdmin, hasPermission])

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  return <>{children}</>
}
