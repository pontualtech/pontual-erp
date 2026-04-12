import { createClient } from './supabase/server'
import { prisma } from '@pontual/db'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { resolveHostname } from './hostname-resolver'

export interface AuthUser {
  id: string
  email: string
  companyId: string
  roleId: string
  roleName: string
  name: string
  isSuperAdmin: boolean
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

    // Resolve hostname to company (subdomain or custom domain)
    const headersList = headers()
    const hostname = headersList.get('host') || ''
    const hostCompany = await resolveHostname(hostname)

    // If hostname maps to a company, find the user's profile for THAT company
    // Otherwise, find any active profile (backward compatible)
    const profileWhere = hostCompany
      ? { id: userData.data.user.id, company_id: hostCompany.id, is_active: true }
      : { id: userData.data.user.id, is_active: true }

    const profile = await prisma.userProfile.findFirst({
      where: profileWhere,
      include: { roles: true },
    })

    if (!profile) return null

    const platformRole = userData.data.user.app_metadata?.platform_role
    const email = userData.data.user.email!
    // Double check: app_metadata + env allowlist
    const allowedEmails = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    const isSuperAdmin = platformRole === 'super_admin' && (allowedEmails.length === 0 || allowedEmails.includes(email.toLowerCase()))

    return {
      id: userData.data.user.id,
      email,
      companyId: profile.company_id,
      roleId: profile.role_id,
      roleName: profile.roles.name.toLowerCase(),
      name: profile.name,
      isSuperAdmin,
    }
  } catch {
    return null
  }
}

/**
 * Retorna o usuário se for super_admin da plataforma.
 * Usado para proteger rotas /api/admin/*
 */
export async function requireSuperAdmin(): Promise<AuthUser | NextResponse> {
  const user = await getServerUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!user.isSuperAdmin) return NextResponse.json({ error: 'Acesso restrito ao administrador da plataforma' }, { status: 403 })
  return user
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
