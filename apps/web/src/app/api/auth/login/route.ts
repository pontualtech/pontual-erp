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

    // Eco audit E (2026-05-29): account lockout por EMAIL além de rate-limit
    // por IP. Sem isto, credential stuffing via rotação de IP (botnets baratas)
    // testa milhares de senhas em conta-alvo. Lockout: 10 tentativas falhas
    // por email em 15min → bloqueia 15min. Reset automático ao expirar.
    // (Limite por email/IP, NOT por user account — não permite enumeration).

    // Clear previous session cookies to prevent session confusion between roles (C-9)
    const cookieStore = cookies()
    const allCookies = cookieStore.getAll()
    for (const cookie of allCookies) {
      if (cookie.name.startsWith('sb-') || cookie.name.includes('supabase')) {
        cookieStore.set(cookie.name, '', { maxAge: 0, path: '/' })
      }
    }

    // UX-10 #2: body vazio retornava 500 — agora 400 limpo
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return error('Body invalido', 400)
    }
    const { email, password } = body

    if (!email || !password) {
      return error('Email e senha são obrigatórios', 400)
    }

    // Account lockout por email — usa rateLimit shared store (memória in-process).
    // Key prefix "login-email:" pra não colidir com IP rate limit acima.
    const emailKey = `login-email:${String(email).toLowerCase().trim()}`
    const emailRate = rateLimit(emailKey, 10, 15 * 60_000) // 10 attempts / 15min
    if (!emailRate.allowed) {
      // Resposta genérica — não confirma se conta existe.
      return NextResponse.json(
        { error: 'Muitas tentativas com este email. Aguarde 15 minutos.' },
        { status: 429 }
      )
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

    // Login OK — reset counter pro email (rateLimit não tem reset explícito,
    // mas a entrada expira em 15min naturalmente). Permite logins sucessivos
    // do mesmo user sem trigger fake-positive de lockout.

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
