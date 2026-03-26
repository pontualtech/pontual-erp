import { createClient } from './supabase/server'
import { prisma } from '@pontual/db'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export interface AuthUser {
  id: string
  email: string
  companyId: string
  roleId: string
  roleName: string
  name: string
}

/**
 * Obtém o usuário autenticado (server-side)
 * Tenta cookie primeiro, depois Bearer token
 */
export async function getServerUser(): Promise<AuthUser | null> {
  try {
    // Tentar via cookie (Supabase SSR)
    const supabase = createClient()
    let userData = await supabase.auth.getUser()

    // Fallback: Bearer token no header
    if (!userData.data.user) {
      const headersList = headers()
      const authHeader = headersList.get('authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        const adminClient = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
        userData = await adminClient.auth.getUser(token)
      }
    }

    if (!userData.data.user) return null

    const profile = await prisma.userProfile.findFirst({
      where: { id: userData.data.user.id, is_active: true },
      include: { roles: true },
    })

    if (!profile) return null

    return {
      id: userData.data.user.id,
      email: userData.data.user.email!,
      companyId: profile.company_id,
      roleId: profile.role_id,
      roleName: profile.roles.name.toLowerCase(),
      name: profile.name,
    }
  } catch {
    return null
  }
}

export async function hasPermission(
  userId: string,
  companyId: string,
  module: string,
  action: string
): Promise<boolean> {
  const profile = await prisma.userProfile.findFirst({
    where: { id: userId, company_id: companyId },
    include: {
      roles: {
        include: {
          role_permissions: {
            include: { permissions: true },
            where: { granted: true },
          },
        },
      },
    },
  })

  if (!profile) return false
  if (profile.roles.name.toLowerCase() === 'admin') return true

  return profile.roles.role_permissions.some(
    rp => rp.permissions.module === module && rp.permissions.action === action
  )
}

export async function requirePermission(
  module: string,
  action: string
): Promise<AuthUser | NextResponse> {
  const user = await getServerUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const allowed = await hasPermission(user.id, user.companyId, module, action)
  if (!allowed) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  return user
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getServerUser()
  if (!user) throw new Error('Não autenticado')
  return user
}
