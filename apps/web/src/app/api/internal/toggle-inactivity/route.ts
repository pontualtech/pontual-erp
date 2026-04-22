import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * POST /api/internal/toggle-inactivity
 *
 * Endpoint one-shot autenticado via X-Internal-Key pra ligar/desligar
 * notify_inactivity em massa ou por motorista. Usado porque admin Bearer
 * auth esta flaky no ambiente de teste — esse endpoint bypassa tudo isso
 * usando apenas X-Internal-Key.
 *
 * Body: {
 *   emails: string[]   // ["emerson@...", "lucas@..."]
 *   enabled: boolean
 * }
 * OU
 *   all_drivers: true  // habilita pra todos motoristas da empresa
 *   company_id: string
 *   enabled: boolean
 */
export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => ({}))
  const enabled = Boolean(body.enabled)

  let updatedUsers: { id: string; email: string; name: string }[] = []

  if (Array.isArray(body.emails) && body.emails.length > 0) {
    const result = await prisma.userProfile.updateMany({
      where: { email: { in: body.emails.map((e: string) => e.toLowerCase()) } },
      data: { notify_inactivity: enabled },
    })
    updatedUsers = await prisma.userProfile.findMany({
      where: { email: { in: body.emails.map((e: string) => e.toLowerCase()) } },
      select: { id: true, email: true, name: true },
    })
    return NextResponse.json({ data: { updated: result.count, users: updatedUsers, enabled } })
  }

  if (body.all_drivers && body.company_id) {
    const result = await prisma.userProfile.updateMany({
      where: {
        company_id: body.company_id,
        roles: { OR: [
          { name: { contains: 'motorista', mode: 'insensitive' } },
          { name: { contains: 'driver', mode: 'insensitive' } },
        ]},
      },
      data: { notify_inactivity: enabled },
    })
    return NextResponse.json({ data: { updated: result.count, enabled } })
  }

  return NextResponse.json({ error: 'Informe emails[] OU (all_drivers + company_id)' }, { status: 400 })
}
