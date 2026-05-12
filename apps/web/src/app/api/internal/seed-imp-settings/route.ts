import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireInternalKey } from '@/lib/internal-auth'

/**
 * ONE-SHOT TEMP — criado 2026-05-12 pra inserir 4 settings Meta Cloud API IMP.
 * REMOVER este arquivo após sucesso da inserção.
 *
 * Body (JSON):
 *   slug (default "imprimitech")
 *   access_token
 *   business_account_id
 *   app_id
 *   app_secret
 *
 * Auth: x-internal-key = INTERNAL_API_KEY
 */
export async function POST(req: NextRequest) {
  const guard = requireInternalKey(req); if (guard) return guard

  const body = await req.json().catch(() => ({}))
  const slug = body.slug || 'imprimitech'
  const { access_token, business_account_id, app_id, app_secret } = body

  if (!access_token || !business_account_id || !app_id || !app_secret) {
    return NextResponse.json({ error: 'fields obrigatorios: access_token, business_account_id, app_id, app_secret' }, { status: 400 })
  }

  const company = await prisma.company.findUnique({ where: { slug }, select: { id: true, slug: true, name: true } })
  if (!company) return NextResponse.json({ error: `company com slug '${slug}' nao encontrada` }, { status: 404 })

  const settings: Array<{ key: string; value: string }> = [
    { key: 'whatsapp.cloud.access_token', value: access_token },
    { key: 'whatsapp.cloud.business_account_id', value: business_account_id },
    { key: 'whatsapp.cloud.app_id', value: app_id },
    { key: 'whatsapp.cloud.app_secret', value: app_secret },
  ]

  const results = await prisma.$transaction(
    settings.map(s =>
      prisma.setting.upsert({
        where: { company_id_key: { company_id: company.id, key: s.key } },
        update: { value: s.value, type: 'string' },
        create: { company_id: company.id, key: s.key, value: s.value, type: 'string' },
      })
    )
  )

  return NextResponse.json({
    company: { id: company.id, slug: company.slug, name: company.name },
    upserted_count: results.length,
    keys: settings.map(s => s.key),
    note: 'Settings inseridas/atualizadas. REMOVER este endpoint após confirmação.',
  })
}
