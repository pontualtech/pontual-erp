import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Rotas públicas
  const publicPaths = ['/login', '/forgot-password', '/reset-password', '/api/auth/', '/api/quotes/approve', '/api/v1/', '/api/fiscal/webhook', '/api/portal/', '/portal/', '/api/integracoes/chatwoot/webhook']
  const isPublic = publicPaths.some(p => request.nextUrl.pathname.startsWith(p))

  // API routes: também aceitar Bearer token no header
  const isApi = request.nextUrl.pathname.startsWith('/api/')
  if (isApi && !user) {
    // Checar Authorization header como fallback
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      // Permitir — a rota API vai validar o token internamente
      return supabaseResponse
    }
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
