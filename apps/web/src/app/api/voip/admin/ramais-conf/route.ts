/**
 * GET /api/voip/admin/ramais-conf
 *
 * Renderiza ramais.conf (apenas a parte dinâmica do PJSIP — os 15 endpoints WebRTC).
 * Consumido pelo script sync-pjsip.sh no host do Asterisk via systemd timer (a cada 60s).
 *
 * Auth: header X-Sync-Token === env PJSIP_SYNC_TOKEN (não usa session).
 *
 * Output: text/plain (config Asterisk pronto pra escrever no volume).
 *
 * Tenant: hardcoded 'pontualtech-001' (Asterisk single-tenant em pabx.pontualtech.work).
 *   Multi-tenant futuro = um Asterisk por tenant, cada qual com seu sync token.
 */

import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@pontual/db'
import { render as renderMustache } from '@/lib/voip/mustache-mini'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COMPANY_ID = 'pontualtech-001'

// Constant-time comparison to prevent timing attacks on token validation
function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// Same template loader as regenerate-config endpoint — checks multiple paths
// because Next standalone build relocates files at runtime.
async function loadTemplate(): Promise<string> {
  const name = 'ramais.conf'
  const candidates = [
    path.join(process.cwd(), 'src', 'lib', 'voip', 'asterisk-templates', `${name}.tmpl`),
    path.join(process.cwd(), '..', '..', 'apps', 'web', 'src', 'lib', 'voip', 'asterisk-templates', `${name}.tmpl`),
    path.join('/app', 'apps', 'web', 'src', 'lib', 'voip', 'asterisk-templates', `${name}.tmpl`),
    path.join(process.cwd(), 'apps', 'web', 'src', 'lib', 'voip', 'asterisk-templates', `${name}.tmpl`),
  ]
  for (const p of candidates) {
    try {
      return await fs.readFile(p, 'utf8')
    } catch {}
  }
  throw new Error(`Template ${name}.tmpl não encontrado`)
}

// Parse "Roberto - Ramal 101" -> "Roberto"
// Parse "Ramal 106 (vago)" -> "Ramal 106"
function extractCallerName(description: string | null, number: string): string {
  if (!description) return `Ramal ${number}`
  const trimmed = description.trim()
  // Pattern "Name - Ramal NNN" => keep "Name"
  const dashMatch = trimmed.match(/^(.+?)\s*[-–—]\s*Ramal\s+\d+/i)
  if (dashMatch) return dashMatch[1].trim()
  return trimmed
}

export async function GET(req: NextRequest) {
  // Token validation — fail fast with same error shape regardless of cause
  const expected = process.env.PJSIP_SYNC_TOKEN
  if (!expected) {
    // Server misconfigured. Don't leak detail to caller.
    return new Response('forbidden', { status: 403 })
  }
  const provided = req.headers.get('x-sync-token') || ''
  if (!safeCompare(provided, expected)) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    const extensions = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT number, description, secret_plain
       FROM voip_extensions
       WHERE company_id=$1 AND is_active=true AND webrtc=true
       ORDER BY number`,
      COMPANY_ID,
    )

    const context = {
      generatedAt: new Date().toISOString(),
      extensionsCount: extensions.length,
      extensions: extensions.map(e => ({
        number: e.number,
        callerName: extractCallerName(e.description, e.number),
        secretPlain: e.secret_plain,
      })),
    }

    const tmpl = await loadTemplate()
    const rendered = renderMustache(tmpl, context)

    return new Response(rendered, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        // Allow sync script to short-circuit if unchanged
        'x-extensions-count': String(extensions.length),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro'
    return new Response(`error: ${msg}`, { status: 500 })
  }
}
