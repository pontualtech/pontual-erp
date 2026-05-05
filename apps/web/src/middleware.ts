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

// Host-based portal routing: portal.<tenant>.com.br should land the customer
// on /portal/<slug>/login, not on the generic ERP login. Map once here.
const PORTAL_HOST_SLUG: Record<string, string> = {
  'portal.pontualtech.com.br': 'pontualtech',
  'portal.imprimitech.com.br': 'imprimitech',
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host') || ''
  const origin = request.headers.get('origin') || ''
  const isAllowedOrigin = CORS_ORIGINS.includes(origin)

  // Redirect root/login paths on customer-portal hosts to the tenant portal login.
  // Only applies to page routes — never to /portal/*, /api/*, /_next/* ou
  // /cupom-avaliacao/* (endpoint publico que cria cupom + redireciona).
  const portalSlug = PORTAL_HOST_SLUG[host.toLowerCase()]
  if (portalSlug && !pathname.startsWith('/portal/') && !pathname.startsWith('/api/') && !pathname.startsWith('/_next/') && !pathname.startsWith('/cupom-avaliacao/') && !pathname.startsWith('/avaliar/') && !pathname.startsWith('/s/')) {
    const url = request.nextUrl.clone()
    url.pathname = `/portal/${portalSlug}/login`
    return NextResponse.redirect(url)
  }

  // Cross-tenant guard: if portal host is serving a path for a DIFFERENT tenant's
  // slug (e.g. portal.pontualtech.com.br/portal/imprimitech/...), redirect to the
  // correct tenant host so each brand stays isolated to its own domain.
  if (portalSlug && pathname.startsWith('/portal/')) {
    const urlSlug = pathname.split('/')[2]
    if (urlSlug && urlSlug !== portalSlug) {
      const targetHost = Object.entries(PORTAL_HOST_SLUG).find(([, s]) => s === urlSlug)?.[0]
      if (targetHost) {
        return NextResponse.redirect(`https://${targetHost}${pathname}${request.nextUrl.search}`)
      }
    }
  }

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
  if (pathname.startsWith('/api/chatwoot/') || pathname.startsWith('/api/webhook/') || pathname.startsWith('/api/webhooks/') || pathname.startsWith('/api/voip/webhooks/')) {
    return NextResponse.next()
  }
  // Public share links (recording downloads via signed token)
  if (pathname.startsWith('/api/voip/share/')) {
    return NextResponse.next()
  }
  // OAuth callback do Google Business — recebido externamente (browser
  // do user apos autorizar). Valida state no handler.
  if (pathname === '/api/integracoes/google-business/callback') {
    return NextResponse.next()
  }
  // Redirect publico do cupom: cliente clica no link WhatsApp, endpoint
  // cria o cupom e devolve 302 pro Google Reviews. Requer ser publico.
  // /avaliar/ = alias mais neutro de /cupom-avaliacao/ (Meta filtra
  // menos URLs com palavras comerciais).
  if (pathname.startsWith('/cupom-avaliacao/') || pathname.startsWith('/avaliar/')) {
    return NextResponse.next()
  }
  // URL shortener publico — cliente recebe link curto via WhatsApp/email
  // e precisa abrir sem autenticacao (handler /s/[slug] faz redirect 302
  // pro magic-link real que entao faz auto-login).
  if (pathname.startsWith('/s/')) {
    return NextResponse.next()
  }
  // Internal routes with their own auth (X-Internal-Key header)
  if (pathname.startsWith('/api/internal/')) {
    return NextResponse.next()
  }
  // Health endpoint público — Coolify Healthcheck precisa acessar sem auth
  if (pathname === '/api/health') {
    return NextResponse.next()
  }
  // Internal notification routes: exact path prefix match only
  if (pathname.startsWith('/api/os/') && (
    pathname.endsWith('/notificar-abertura') || pathname.endsWith('/notificar-pronto') || pathname.endsWith('/notificar-coleta')
  )) {
    return NextResponse.next()
  }

  // PATCH 7: API routes without auth return 401 JSON (not HTML SPA shell).
  // REVERTED to substring check — strict regex was blocking self-hosted
  // Supabase cookies that don't match `sb-[a-z0-9]+-auth-token`. The
  // downstream route handlers validate via requirePermission anyway, so
  // this middleware is defense-in-depth only.
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
     * - public files: images, fonts, service-worker.js, PWA manifest.
     * Adding `js` and `webmanifest` pra liberar o Service Worker do
     * motorista (/motorista/sw.js) e o manifest (/motorista/manifest.webmanifest)
     * que antes caiam no redirect do Supabase updateSession.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest|js)$).*)',
  ],
}
