import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * UX-4 #7: ingest endpoint pra Web Vitals reportados pelo client.
 * Por enquanto loga estruturado (Coolify lê stdout). Próximo passo seria
 * persistir em tabela `web_vitals(name, value, rating, path, user_agent,
 * created_at)` com partição mensal pra agregação. Aceita beacon — sempre 204.
 *
 * Não exige auth (telemetry pública por path). Anti-abuso: rate-limit no
 * proxy / Coolify se virar problema.
 */
export async function POST(req: NextRequest) {
  try {
    // UX-9 #8: rate limit por IP — endpoint pode ser spammed (sem auth).
    // 60 reqs/min/IP é generoso pra Web Vitals legítimo (LCP+CLS+FID+INP+TTFB
    // = 5 metrics × N páginas), mas barra bot.
    const ip = getClientIp(req)
    const { allowed } = rateLimit(`vitals:${ip}`, 60, 60_000)
    if (!allowed) return new NextResponse(null, { status: 429 })

    const data = await req.json().catch(() => null)
    if (data && typeof data === 'object') {
      // Log estruturado pra Coolify ingestion (futuro: substituir por insert no banco)
      console.log('[web-vitals]', JSON.stringify({
        name: data.name,
        value: data.value,
        rating: data.rating,
        path: data.path,
        navigationType: data.navigationType,
        ua: req.headers.get('user-agent')?.slice(0, 100),
      }))
    }
  } catch { /* swallow */ }
  return new NextResponse(null, { status: 204 })
}
