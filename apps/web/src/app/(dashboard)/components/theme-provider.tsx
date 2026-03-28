'use client'

import { useEffect, useState } from 'react'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Load theme from settings API
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        const data = d.data || {}
        for (const group of Object.values(data) as any[]) {
          for (const [key, val] of Object.entries(group)) {
            if (key === 'aparencia.tema' && (val as any)?.value === 'dark') {
              setTheme('dark')
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  if (!loaded) return <>{children}</>

  return <>{children}</>
}
