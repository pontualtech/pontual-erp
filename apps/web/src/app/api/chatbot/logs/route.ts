import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/chatbot/logs — Ultimos 20 logs de conversa do chatbot
 */
export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const logs = await prisma.chatbotLog.findMany({
      where: { company_id: user.companyId },
      orderBy: { created_at: 'desc' },
      take: 20,
    })

    return success(logs)
  } catch (err) {
    return handleError(err)
  }
}
