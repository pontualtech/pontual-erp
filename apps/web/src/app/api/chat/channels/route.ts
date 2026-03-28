import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Get distinct channels with last message
    const channels = await prisma.$queryRaw<
      { channel: string; last_message: string; last_at: Date; msg_count: number }[]
    >`
      SELECT
        channel,
        (SELECT message FROM chat_messages cm2
         WHERE cm2.company_id = cm.company_id AND cm2.channel = cm.channel
         ORDER BY created_at DESC LIMIT 1) as last_message,
        MAX(created_at) as last_at,
        COUNT(*)::int as msg_count
      FROM chat_messages cm
      WHERE company_id = ${user.companyId}
      GROUP BY company_id, channel
      ORDER BY MAX(created_at) DESC
    `

    // Ensure "geral" always exists
    const hasGeral = channels.some(c => c.channel === 'geral')
    if (!hasGeral) {
      channels.unshift({
        channel: 'geral',
        last_message: '',
        last_at: new Date(),
        msg_count: 0,
      })
    }

    return success(channels)
  } catch (err) {
    return handleError(err)
  }
}
