import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * Operator-side counterpart to /api/driver/chat.
 *
 * GET /api/dashboard/driver-chat
 *   Lists drivers + their latest message (for the conversation sidebar)
 *
 * GET /api/dashboard/driver-chat?driver_id=X&since=ISO
 *   Fetches messages of a specific driver channel (since incremental polling)
 *
 * POST /api/dashboard/driver-chat  { driver_id, message }
 *   Operator sends a message to a driver's channel
 */

function channelFor(driverId: string) {
  return `driver:${driverId}`
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('logistica', 'view')
  if (auth instanceof NextResponse) return auth

  const driverId = req.nextUrl.searchParams.get('driver_id')
  const since = req.nextUrl.searchParams.get('since')
  const sinceDate = since ? new Date(since) : null

  if (driverId) {
    // Single conversation
    const messages = await prisma.chatMessage.findMany({
      where: {
        company_id: auth.companyId,
        channel: channelFor(driverId),
        ...(sinceDate && !isNaN(sinceDate.getTime()) ? { created_at: { gt: sinceDate } } : {}),
      },
      orderBy: { created_at: 'asc' },
      take: 200,
    })
    return NextResponse.json({
      data: {
        messages: messages.map(m => ({
          id: m.id,
          sender_id: m.sender_id,
          sender_name: m.sender_name,
          message: m.message,
          is_me: m.sender_id === auth.id,
          is_driver: m.sender_id === driverId,
          created_at: m.created_at,
        })),
      },
    })
  }

  // Sidebar list — find every UserProfile with role *motorista* and join last
  // message of their channel.
  const drivers = await prisma.userProfile.findMany({
    where: {
      company_id: auth.companyId,
      is_active: true,
      roles: {
        OR: [
          { name: { contains: 'motorista', mode: 'insensitive' } },
          { name: { contains: 'driver', mode: 'insensitive' } },
        ],
      },
    },
    select: { id: true, name: true, avatar_url: true },
  })

  // Last message per driver (1 query each is fine for ≤ ~10 drivers; otherwise
  // groupBy with raw SQL window function — out of scope for MVP)
  const items = await Promise.all(drivers.map(async d => {
    const last = await prisma.chatMessage.findFirst({
      where: { company_id: auth.companyId, channel: channelFor(d.id) },
      orderBy: { created_at: 'desc' },
      select: { id: true, message: true, sender_id: true, sender_name: true, created_at: true },
    })
    return {
      driver_id: d.id,
      driver_name: d.name,
      avatar_url: d.avatar_url,
      last_message: last ? {
        text: last.message,
        sender_name: last.sender_name,
        from_driver: last.sender_id === d.id,
        at: last.created_at,
      } : null,
    }
  }))

  // Sort by most recent activity
  items.sort((a, b) => {
    const ta = a.last_message?.at ? new Date(a.last_message.at).getTime() : 0
    const tb = b.last_message?.at ? new Date(b.last_message.at).getTime() : 0
    return tb - ta
  })

  return NextResponse.json({ data: { drivers: items } })
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('logistica', 'edit')
  if (auth instanceof NextResponse) return auth

  const { driver_id, message } = await req.json().catch(() => ({}))
  if (!driver_id) return NextResponse.json({ error: 'driver_id obrigatorio' }, { status: 400 })
  if (!message?.trim()) return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 })
  if (message.length > 2000) return NextResponse.json({ error: 'Mensagem muito longa' }, { status: 400 })

  // Validate driver belongs to same company
  const driver = await prisma.userProfile.findFirst({
    where: { id: driver_id, company_id: auth.companyId, is_active: true },
    select: { id: true },
  })
  if (!driver) return NextResponse.json({ error: 'Motorista nao encontrado' }, { status: 404 })

  const created = await prisma.chatMessage.create({
    data: {
      company_id: auth.companyId,
      sender_id: auth.id,
      sender_name: auth.name,
      message: message.trim(),
      channel: channelFor(driver_id),
    },
  })

  // Push notification fire-and-forget — motorista recebe mesmo com app fechado.
  // Se nao tiver subscription, web-push silenciosamente devolve {sent:0}.
  void (async () => {
    try {
      const { sendPushToUser } = await import('@/lib/web-push')
      await sendPushToUser(driver_id, {
        title: `Mensagem de ${auth.name.split(' ')[0]}`,
        body: created.message.slice(0, 140),
        url: '/motorista/chat',
        tag: `chat:${driver_id}`,
      })
    } catch (err) {
      console.warn('[driver-chat] push falhou:', err instanceof Error ? err.message : String(err))
    }
  })()

  return NextResponse.json({
    data: {
      id: created.id,
      sender_id: created.sender_id,
      sender_name: created.sender_name,
      message: created.message,
      is_me: true,
      is_driver: false,
      created_at: created.created_at,
    },
  })
}
