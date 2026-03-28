'use client'

import { useEffect, useState } from 'react'

interface AuthInfo { id: string; name: string; email: string; role: string; companyId: string }

let cached: AuthInfo | null = null

export function useAuth() {
  const [user, setUser] = useState<AuthInfo | null>(cached)

  useEffect(() => {
    if (cached) { setUser(cached); return }
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.data) { cached = d.data; setUser(d.data) }
    }).catch(() => {})
  }, [])

  return { user, isAdmin: user?.role === 'admin' }
}
