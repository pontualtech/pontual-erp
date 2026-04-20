import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { rateLimit } from '@/lib/rate-limit'

/**
 * Each driver has a private channel `driver:<userId>` that only the driver
 * itself and ERP operators can read/write. The channel name lives in
 * ChatMessage.channel — no new table needed.
 */
function channelFor(driverId: string) {
  return `driver:${driverId}`
}

// GET /api/driver/chat?since=ISO  — fetch latest msgs (default last 100)
export async function GET(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const since = req.nextUrl.searchParams.get('since')
  const sinceDate = since ? new Date(since) : null

  const messages = await prisma.chatMessage.findMany({
    where: {
      company_id: auth.companyId,
      channel: channelFor(auth.id),
      ...(sinceDate && !isNaN(sinceDate.getTime()) ? { created_at: { gt: sinceDate } } : {}),
    },
    orderBy: { created_at: 'asc' },
    take: 100,
  })

  return NextResponse.json({
    data: {
      driver_id: auth.id,
      messages: messages.map(m => ({
        id: m.id,
        sender_id: m.sender_id,
        sender_name: m.sender_name,
        message: m.message,
        is_me: m.sender_id === auth.id,
        created_at: m.created_at,
      })),
    },
  })
}

// POST /api/driver/chat  — driver sends a message
export async function POST(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  // Anti-spam: 30 msgs/min per driver. Ample for normal use.
  const rl = rateLimit(`driver-chat:${auth.id}`, 30, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Muitas mensagens' }, { status: 429 })

  const { message } = await req.json().catch(() => ({}))
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 })
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: 'Mensagem muito longa' }, { status: 400 })
  }

  const created = await prisma.chatMessage.create({
    data: {
      company_id: auth.companyId,
      sender_id: auth.id,
      sender_name: auth.name,
      message: message.trim(),
      channel: channelFor(auth.id),
    },
  })

  return NextResponse.json({
    data: {
      id: created.id,
      sender_id: created.sender_id,
      sender_name: created.sender_name,
      message: created.message,
      is_me: true,
      created_at: created.created_at,
    },
  })
}
