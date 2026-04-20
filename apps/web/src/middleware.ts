import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Origins allowed to call /api/bot/* from the browser (CORS)
const CORS_ORIGINS = [
  'https://pontualtech.com.br',
  'https://www.pontualtech.com.br',
  'https://imprimitech.com.br',
  'https://www.imprimitech.com.br',
]

function withCors(response: NextResponse, origin: string): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Bot-Key')
  response.headers.set('Access-Control-Max-Age', '86400')
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const origin = request.headers.get('origin') || ''
  const isAllowedOrigin = CORS_ORIGINS.includes(origin)

  // Bot API routes: skip auth, add CORS for pontualtech.com.br
  if (pathname.startsWith('/api/bot/')) {
    if (request.method === 'OPTIONS' && isAllowedOrigin) {
      return withCors(new NextResponse(null, { status: 204 }), origin)
    }
    const response = NextResponse.next()
    if (isAllowedOrigin) withCors(response, origin)
    return response
  }

  // Skip auth for webhooks and internal notification endpoints (called by bot routes)
  if (pathname.startsWith('/api/chatwoot/') || pathname.startsWith('/api/webhook/') || pathname.startsWith('/api/webhooks/')) {
    return NextResponse.next()
  }
  // Internal routes with their own auth (X-Internal-Key header)
  if (pathname.startsWith('/api/internal/')) {
    return NextResponse.next()
  }
  // Internal notification routes: exact path prefix match only
  if (pathname.startsWith('/api/os/') && (
    pathname.endsWith('/notificar-abertura') || pathname.endsWith('/notificar-pronto') || pathname.endsWith('/notificar-coleta')
  )) {
    return NextResponse.next()
  }

  // PATCH 7: API routes without auth return 401 JSON (not HTML SPA shell)
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/portal/')) {
    const hasAuthCookie = request.cookies.getAll().some(c => c.name.includes('auth-token') || c.name.includes('supabase'))
    const hasBearerToken = request.headers.get('authorization')?.startsWith('Bearer ')
    if (!hasAuthCookie && !hasBearerToken) {
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
