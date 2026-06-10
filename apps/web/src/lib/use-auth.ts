'use client'

import { useEffect, useState } from 'react'

interface PermissionEntry { module: string; action: string }

interface AuthInfo {
  id: string
  name: string
  email: string
  role: string
  companyId: string
  permissions: PermissionEntry[]
  isSuperAdmin?: boolean
}

let cached: AuthInfo | null = null
let cacheTime = 0
// Promise in-flight compartilhada: sem isto, N componentes montando juntos no
// primeiro load checam `cached` (ainda null) e disparam N fetches paralelos a
// /api/auth/me (cache stampede). Cachear a promise dedupe pra 1 request.
// Mesmo padrão de lib/use-avisos.ts.
let inflight: Promise<AuthInfo | null> | null = null
const CACHE_TTL = 60000 // 1 minuto — recarrega permissões periodicamente

function fetchMe(): Promise<AuthInfo | null> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) return Promise.resolve(cached)
  if (inflight) return inflight
  inflight = fetch('/api/auth/me')
    .then(r => r.json())
    .then(d => {
      if (d.data) {
        d.data.permissions = d.data.permissions ?? []
        cached = d.data
        cacheTime = Date.now()
        return cached
      }
      return cached
    })
    .catch(() => cached)
    .finally(() => { inflight = null })
  return inflight
}

export function useAuth() {
  const [user, setUser] = useState<AuthInfo | null>(cached)

  useEffect(() => {
    let active = true
    fetchMe().then(u => { if (active && u) setUser(u) })
    return () => { active = false }
  }, [])

  const isAdmin = user?.role === 'admin'
  const isSuperAdmin = user?.isSuperAdmin === true

  function hasPermission(module: string, action: string = 'view'): boolean {
    if (!user) return false
    if (isAdmin) return true
    return user.permissions.some(p => p.module === module && p.action === action)
  }

  return { user, isAdmin, isSuperAdmin, hasPermission }
}
