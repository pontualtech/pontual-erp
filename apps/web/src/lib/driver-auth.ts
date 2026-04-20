import { NextResponse } from 'next/server'
import { getServerUser, type AuthUser } from './auth'

/**
 * Guards driver-app routes. Any authenticated user whose role name contains
 * "motorista" OR "driver" is allowed — matches the ERP's role-naming
 * convention. Returning a NextResponse short-circuits the handler; returning
 * the AuthUser lets the handler proceed.
 *
 * We deliberately do NOT require a specific permission flag — the route guard
 * IS the permission boundary for driver endpoints.
 */
export async function requireDriver(): Promise<AuthUser | NextResponse> {
  const user = await getServerUser()
  if (!user) {
    return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
  }
  const role = user.roleName.toLowerCase()
  const isDriver = role.includes('motorista') || role.includes('driver')
  if (!isDriver && !user.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas motoristas podem acessar' }, { status: 403 })
  }
  return user
}
