import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * N12 fix (audit pos-fix): valida x-internal-key APENAS contra
 * INTERNAL_API_KEY com timing-safe compare. Antes routes aceitavam
 * `[CRON_SECRET, CHATWOOT_WEBHOOK_SECRET, INTERNAL_API_KEY]` em OR —
 * vazamento de qualquer um comprometia o conjunto. Helper reusável.
 *
 * Uso em route handler:
 *   const guard = requireInternalKey(req)
 *   if (guard) return guard
 *
 * Retorna NextResponse 401/503 se inválido; null se OK.
 */
export function requireInternalKey(req: NextRequest): NextResponse | null {
  const expected = process.env.INTERNAL_API_KEY
  if (!expected) {
    console.error('[InternalAuth] INTERNAL_API_KEY não configurado')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  const provided = req.headers.get('x-internal-key') ?? ''
  if (provided.length !== expected.length) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    if (timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return null
    }
  } catch {}
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
