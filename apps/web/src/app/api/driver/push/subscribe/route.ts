import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'

/**
 * POST /api/driver/push/subscribe
 * Body: { endpoint: string, keys: { p256dh: string, auth: string } }
 *
 * Salva a PushSubscription. Idempotente via endpoint UNIQUE — se mesmo
 * device se inscreve de novo, atualiza last_seen + user_id (caso outro
 * motorista logue no mesmo aparelho).
 */
export async function POST(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const { endpoint, keys } = body || {}
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'subscription invalida' }, { status: 400 })
  }

  await prisma.driverPushSubscription.upsert({
    where: { endpoint },
    update: { user_id: auth.id, p256dh: keys.p256dh, auth: keys.auth, last_seen: new Date() },
    create: {
      user_id: auth.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: req.headers.get('user-agent') || null,
      last_seen: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/driver/push/subscribe
 * Body: { endpoint: string }
 * Remove a subscription (chamado quando o user nega permissão depois ou logout).
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  if (!body?.endpoint) return NextResponse.json({ error: 'endpoint obrigatorio' }, { status: 400 })

  await prisma.driverPushSubscription.deleteMany({ where: { endpoint: body.endpoint, user_id: auth.id } })
  return NextResponse.json({ ok: true })
}
