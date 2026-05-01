/**
 * GET /api/internal/voip/ramais-conf
 *
 * Renderiza ramais.conf (apenas a parte dinâmica do PJSIP — endpoints WebRTC).
 * Consumido pelo script sync-pjsip.sh no host do Asterisk via systemd timer (a cada 60s).
 *
 * Path /api/internal/* pula o auth-cookie do middleware (ver src/middleware.ts:87-89);
 * autenticação aqui é via header X-Sync-Token === env PJSIP_SYNC_TOKEN (constant-time compare).
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
  // A9 fix (audit): suporte a graceful rotation via PJSIP_SYNC_TOKEN_PREVIOUS.
  // Permite trocar PJSIP_SYNC_TOKEN sem quebrar o sync-pjsip.sh imediatamente:
  //   1. Setar PJSIP_SYNC_TOKEN_PREVIOUS = valor atual
  //   2. Setar PJSIP_SYNC_TOKEN = novo valor
  //   3. Atualizar host Asterisk com novo
  //   4. Remover PJSIP_SYNC_TOKEN_PREVIOUS após confirmar
  // Recomendação: rotacionar mensalmente. SECRETS PERMANENTES = RISK PERMANENTE.
  //
  // Plus: audit log per access (rastreabilidade de quem sincroniza, quando).
  const expected = process.env.PJSIP_SYNC_TOKEN
  const previous = process.env.PJSIP_SYNC_TOKEN_PREVIOUS
  if (!expected) {
    return new Response('forbidden', { status: 403 })
  }
  const provided = req.headers.get('x-sync-token') || ''
  const validated = safeCompare(provided, expected) ||
    (previous ? safeCompare(provided, previous) : false)
  if (!validated) {
    return new Response('forbidden', { status: 403 })
  }
  const usedPrevious = previous && safeCompare(provided, previous) && !safeCompare(provided, expected)
  if (usedPrevious) {
    console.warn('[ramais-conf] sync-pjsip.sh ainda usando PJSIP_SYNC_TOKEN_PREVIOUS — atualizar o host Asterisk com o novo token')
  }

  // Audit access (fire-and-forget)
  prisma.auditLog.create({
    data: {
      company_id: COMPANY_ID,
      user_id: 'system:pjsip-sync',
      module: 'voip',
      action: 'ramais_conf.read',
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      new_value: { used_previous_token: !!usedPrevious },
    },
  }).catch(() => {})

  try {
    // Inclui TODOS os ramais WebRTC (mesmo inativos/vagos) pra pre-carregar no
    // Asterisk. Permite admin ativar um ramal só mudando is_active no DB sem
    // precisar reload do PJSIP — endpoint já existe, só falta o REGISTER do
    // browser. Endpoints sem REGISTER ficam "Unavailable", inofensivos.
    const extensions = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT number, description, secret_plain
       FROM voip_extensions
       WHERE company_id=$1 AND webrtc=true
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
