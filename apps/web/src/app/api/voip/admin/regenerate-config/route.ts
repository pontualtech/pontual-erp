/**
 * POST /api/voip/admin/regenerate-config
 *
 * Renderiza pjsip.conf, extensions.conf, http.conf, manager.conf, ari.conf
 * a partir do banco (voip_extensions). Retorna os 5 arquivos como JSON pra
 * que um agente externo (script de scheduled-task) escreva no volume Docker
 * do Asterisk e dispare reload.
 *
 * Auth: requireAuth + admin.
 *
 * Por enquanto retorna JSON; nao escreve direto pq ERP container nao
 * compartilha volume com Asterisk container (network mode diferente).
 */

import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'
import { render as renderMustache } from '@/lib/voip/mustache-mini'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAdmin(roleId: string | null | undefined): boolean {
  if (!roleId) return false
  return /admin/i.test(roleId)
}

const TEMPLATES = ['pjsip.conf', 'extensions.conf', 'http.conf', 'manager.conf', 'ari.conf']

// Templates copiados pra dentro de src/lib pra Next bundlear no build standalone.
async function loadTemplate(name: string): Promise<string> {
  // __dirname em Next standalone aponta pro chunk no .next/server/app/api/...
  // Vamos buscar no caminho conhecido relativo ao diretorio src/lib.
  const candidates = [
    // Dev (apps/web cwd)
    path.join(process.cwd(), 'src', 'lib', 'voip', 'asterisk-templates', `${name}.tmpl`),
    // Prod standalone (cwd = .next/standalone/apps/web)
    path.join(process.cwd(), '..', '..', 'apps', 'web', 'src', 'lib', 'voip', 'asterisk-templates', `${name}.tmpl`),
    // Prod alternative (rooted)
    path.join('/app', 'apps', 'web', 'src', 'lib', 'voip', 'asterisk-templates', `${name}.tmpl`),
    // Prod monorepo standalone
    path.join(process.cwd(), 'apps', 'web', 'src', 'lib', 'voip', 'asterisk-templates', `${name}.tmpl`),
  ]
  for (const p of candidates) {
    try {
      return await fs.readFile(p, 'utf8')
    } catch {}
  }
  throw new Error(`Template ${name}.tmpl nao encontrado em ${candidates.join('; ')}`)
}

export async function POST(_req: NextRequest) {
  try {
    const user = await requireAuth()
    if (!user.isSuperAdmin && !isAdmin(user.roleId)) return error('Permissao admin requerida', 403)

    // Carrega ramais ativos
    const extensions = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT number, description, caller_id_internal, webrtc, max_contacts, call_limit,
              secret_plain, context_tag
       FROM voip_extensions
       WHERE company_id=$1 AND is_active=true
       ORDER BY number`,
      user.companyId,
    )

    const tenantTag = 'pontualtech' // hoje single-tenant; multi-tenant em fase posterior

    const context = {
      generatedAt: new Date().toISOString(),
      tenants: [{ tenantTag }],
      providers: [
        {
          name: 'Sonax',
          companyName: 'PontualTech',
          tenantTag,
          transport: 'udp',
          contextInbound: `from-trunk-${tenantTag}`,
          codecs: ['ulaw', 'alaw'],
          dtmfMode: 'rfc4733',
          isIpBased: true,
          matchIp: '200.201.212.68/32',
          hostOutbound: 'ipbx.sonax.net.br',
          port: '5080',
          qualifyFrequency: 60,
        },
      ],
      extensions: extensions.map(e => ({
        number: e.number,
        webrtc: !!e.webrtc,
        context: e.context_tag,
        tenantTag,
        secretPlain: e.secret_plain,
        maxContacts: e.max_contacts,
        callLimit: e.call_limit,
      })),
    }

    const rendered: Record<string, string> = {}
    const errors: string[] = []
    for (const tmpl of TEMPLATES) {
      try {
        const src = await loadTemplate(tmpl)
        rendered[`${tmpl}`] = renderMustache(src, context)
      } catch (e) {
        errors.push(`${tmpl}: ${e instanceof Error ? e.message : 'erro'}`)
      }
    }

    return success({
      generated_at: context.generatedAt,
      tenant: tenantTag,
      extensions_count: extensions.length,
      files: rendered,
      errors: errors.length ? errors : undefined,
      hint: 'Salve files[*] em /etc/asterisk/ do container e rode: asterisk -rx "module reload res_pjsip.so"',
    })
  } catch (e) {
    return handleError(e)
  }
}
