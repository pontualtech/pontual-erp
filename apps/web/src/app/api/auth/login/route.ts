import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const { allowed } = rateLimit(ip, 5, 60000) // 5 per minute
    if (!allowed) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde um momento.' }, { status: 429 })
    }

    // Clear previous session cookies to prevent session confusion between roles (C-9)
    const cookieStore = cookies()
    const allCookies = cookieStore.getAll()
    for (const cookie of allCookies) {
      if (cookie.name.startsWith('sb-') || cookie.name.includes('supabase')) {
        cookieStore.set(cookie.name, '', { maxAge: 0, path: '/' })
      }
    }

    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return error('Email e senha são obrigatórios', 400)
    }

    const supabase = createClient()
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData.user) {
      return error(
        authError?.message === 'Invalid login credentials'
          ? 'Email ou senha incorretos'
          : authError?.message || 'Erro ao fazer login',
        401
      )
    }

    // Buscar profiles (snake_case do prisma db pull)
    const profiles = await prisma.userProfile.findMany({
      where: { id: authData.user.id, is_active: true },
      include: {
        roles: { select: { id: true, name: true } },
        companies: { select: { id: true, name: true, slug: true, logo: true } },
      },
    })

    if (profiles.length === 0) {
      await supabase.auth.signOut()
      return error('Nenhuma empresa vinculada a este usuário', 403)
    }

    const first = profiles[0]

    return success({
      user: {
        id: first.id,
        name: first.name,
        email: first.email,
        role: first.roles,
      },
      companies: profiles.map(p => ({
        id: p.companies.id,
        name: p.companies.name,
        slug: p.companies.slug,
        logo: p.companies.logo,
        role: p.roles.name,
      })),
      activeCompany: first.companies,
    })
  } catch (err) {
    return handleError(err)
  }
}
