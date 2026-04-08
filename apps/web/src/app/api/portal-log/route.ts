import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || 100)))

    const logs = await prisma.auditLog.findMany({
      where: {
        company_id: user.companyId,
        OR: [
          { action: { contains: 'portal' } },
          { action: { contains: 'customer' } },
          { action: { contains: 'quote' } },
          { action: { contains: 'nps' } },
          { user_id: 'portal' },
          { user_id: { contains: 'BOT_ANA' } },
          { module: 'portal' },
          { module: 'nps' },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    })

    const data = logs.map((log) => {
      const type = inferType(log.action, log.module)
      return {
        id: log.id,
        type,
        module: log.module,
        action: log.action,
        entity_id: log.entity_id,
        user_id: log.user_id,
        description: buildDescription(log),
        old_value: log.old_value,
        new_value: log.new_value,
        timestamp: log.created_at,
      }
    })

    return success({ logs: data })
  } catch (err) {
    return handleError(err)
  }
}

function inferType(action: string, module: string): string {
  const a = action.toLowerCase()
  const m = module.toLowerCase()
  if (a.includes('approv') || a.includes('aceito') || a.includes('aprovad')) return 'approval'
  if (a.includes('reject') || a.includes('recusad') || a.includes('negad')) return 'rejection'
  if (a.includes('nps')) return 'nps'
  if (a.includes('view') || a.includes('visualiz')) return 'view'
  if (a.includes('login') || a.includes('auth')) return 'login'
  if (a.includes('ticket') || a.includes('message') || a.includes('mensag')) return 'ticket'
  if (a.includes('quote') || a.includes('orcamento') || a.includes('orçamento')) return 'quote'
  if (a.includes('bot') || m === 'bot') return 'bot'
  if (a.includes('create') || a.includes('cri')) return 'create'
  if (a.includes('payment') || a.includes('pagament')) return 'payment'
  return 'other'
}

function buildDescription(log: {
  action: string
  module: string
  entity_id: string | null
  user_id: string
  new_value: unknown
}): string {
  const who = log.user_id || 'Sistema'
  const entity = log.entity_id ? ` #${log.entity_id}` : ''
  return `${who} — ${log.action}${entity}`
}
