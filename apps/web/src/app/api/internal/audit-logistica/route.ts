import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * GET /api/internal/audit-logistica?company_id=X
 *
 * Endpoint de diagnostico: reporta se uma empresa tem todos os pre-requisitos
 * pro modulo de logistica funcionar. Usado pra auditar Imprimitech antes de
 * habilitar a logistica completa.
 *
 * Checks:
 *  1. Empresa existe e esta ativa
 *  2. Tem role "Motorista" (pra driver-auth reconhecer)
 *  3. Tem status "Coletar" e "Entregar Reparado" no modulo OS
 *  4. Tem motorista(s) cadastrado(s) com phone (pra WhatsApp)
 *  5. HQ (sede) configurada nas settings
 *  6. Admin com phone (pra receber alertas de inatividade)
 */
export async function GET(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key')
  const validKeys = [
    process.env.INTERNAL_API_KEY,
    process.env.BOT_WEBHOOK_SECRET,
    process.env.CRON_SECRET,
    process.env.CHATWOOT_WEBHOOK_SECRET,
  ].filter(Boolean)
  if (!internalKey || !validKeys.includes(internalKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companyId = req.nextUrl.searchParams.get('company_id')
  if (!companyId) return NextResponse.json({ error: 'company_id obrigatorio' }, { status: 400 })

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, slug: true, is_active: true },
  })
  if (!company) return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })

  const [roles, statuses, drivers, admins, addressSettings] = await Promise.all([
    prisma.role.findMany({
      where: {
        company_id: companyId,
        OR: [
          { name: { contains: 'motorista', mode: 'insensitive' } },
          { name: { contains: 'driver', mode: 'insensitive' } },
          { name: { contains: 'admin', mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
    }),
    prisma.moduleStatus.findMany({
      where: {
        company_id: companyId, module: 'os',
        OR: [
          { name: { contains: 'colet', mode: 'insensitive' } },
          { name: { contains: 'entreg', mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, is_final: true, is_default: true },
    }),
    prisma.userProfile.findMany({
      where: {
        company_id: companyId, is_active: true,
        roles: { OR: [
          { name: { contains: 'motorista', mode: 'insensitive' } },
          { name: { contains: 'driver', mode: 'insensitive' } },
        ]},
      },
      select: { id: true, name: true, email: true, phone: true, notify_inactivity: true },
    }),
    prisma.userProfile.findMany({
      where: {
        company_id: companyId, is_active: true,
        roles: { name: { contains: 'admin', mode: 'insensitive' } },
      },
      select: { id: true, name: true, email: true, phone: true },
    }),
    prisma.setting.findMany({
      where: {
        company_id: companyId,
        key: { in: [
          'cnab.endereco', 'company.number', 'cnab.bairro',
          'cnab.cidade', 'cnab.uf', 'cnab.cep',
          'geocoding.hq_lat', 'geocoding.hq_lng',
        ]},
      },
      select: { key: true, value: true },
    }),
  ])

  const addr = Object.fromEntries(addressSettings.map(s => [s.key, s.value]))
  const hqConfigured = !!(addr['cnab.endereco'] && addr['cnab.cidade'] && addr['cnab.uf'])

  const checks = {
    company: { ok: !!(company.is_active), name: company.name, slug: company.slug },
    role_motorista: { ok: roles.some(r => /motorista|driver/i.test(r.name)), roles: roles.filter(r => /motorista|driver/i.test(r.name)).map(r => r.name) },
    role_admin: { ok: roles.some(r => /admin/i.test(r.name)), roles: roles.filter(r => /admin/i.test(r.name)).map(r => r.name) },
    status_coletar: { ok: statuses.some(s => /colet/i.test(s.name)), statuses: statuses.filter(s => /colet/i.test(s.name)).map(s => s.name) },
    status_entregar: { ok: statuses.some(s => /entreg/i.test(s.name)), statuses: statuses.filter(s => /entreg/i.test(s.name)).map(s => s.name) },
    drivers: { count: drivers.length, list: drivers.map(d => ({ name: d.name, email: d.email, has_phone: !!d.phone, notify_inactivity: d.notify_inactivity })) },
    admins: { count: admins.length, list: admins.map(a => ({ name: a.name, email: a.email, has_phone: !!a.phone })) },
    hq_address: {
      configured: hqConfigured,
      geocoded: !!(addr['geocoding.hq_lat'] && addr['geocoding.hq_lng']),
      fields: addr,
    },
  }

  return NextResponse.json({ data: { company_id: companyId, checks } })
}
