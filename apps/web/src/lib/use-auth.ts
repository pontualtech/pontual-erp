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
const CACHE_TTL = 60000 // 1 minuto — recarrega permissões periodicamente

export function useAuth() {
  const [user, setUser] = useState<AuthInfo | null>(cached)

  useEffect(() => {
    // Usar cache se ainda válido
    if (cached && Date.now() - cacheTime < CACHE_TTL) { setUser(cached); return }
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.data) {
        d.data.permissions = d.data.permissions ?? []
        cached = d.data
        cacheTime = Date.now()
        setUser(d.data)
      }
    }).catch(() => {})
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
