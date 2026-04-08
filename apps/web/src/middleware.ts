import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // PATCH 7: API routes without auth return 401 JSON (not HTML SPA shell)
  // Skip ALL middleware for webhooks (they use their own auth: token/secret)
  if (pathname.startsWith('/api/chatwoot/') || pathname.startsWith('/api/webhook/')) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/portal/')) {
    const hasAuthCookie = request.cookies.getAll().some(c => c.name.includes('auth-token') || c.name.includes('supabase'))
    if (!hasAuthCookie) {
      return NextResponse.json(
        { error: 'Não autenticado' },
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
