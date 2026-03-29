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
}

let cached: AuthInfo | null = null

export function useAuth() {
  const [user, setUser] = useState<AuthInfo | null>(cached)

  useEffect(() => {
    if (cached) { setUser(cached); return }
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.data) {
        // Ensure permissions array exists for backwards compatibility
        d.data.permissions = d.data.permissions ?? []
        cached = d.data
        setUser(d.data)
      }
    }).catch(() => {})
  }, [])

  const isAdmin = user?.role === 'admin'

  function hasPermission(module: string, action: string = 'view'): boolean {
    if (!user) return false
    if (isAdmin) return true
    return user.permissions.some(p => p.module === module && p.action === action)
  }

  return { user, isAdmin, hasPermission }
}
