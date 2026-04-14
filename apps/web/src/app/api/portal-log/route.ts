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
    const typeFilter = searchParams.get('type') || ''

    const logs = await prisma.auditLog.findMany({
      where: {
        company_id: user.companyId,
        OR: [
          { action: { contains: 'portal' } },
          { action: { contains: 'customer' } },
          { action: { contains: 'quote' } },
          { action: { contains: 'nps' } },
          { action: { contains: 'transition' } },
          { action: { contains: 'create' } },
          { user_id: 'portal' },
          { user_id: { contains: 'BOT' } },
          { module: 'portal' },
          { module: 'nps' },
          { module: 'os' },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    })

    // Resolve user names
    const userIds = [...new Set(logs.map(l => l.user_id).filter(id => id && id !== 'portal' && id !== 'system' && !id.startsWith('BOT')))]
    const users = userIds.length > 0
      ? await prisma.userProfile.findMany({
          where: { id: { in: userIds }, company_id: user.companyId },
          select: { id: true, name: true },
        })
      : []
    const userMap = new Map(users.map(u => [u.id, u.name]))

    // Resolve OS numbers from entity_ids
    const entityIds = [...new Set(logs.filter(l => l.module === 'os' && l.entity_id).map(l => l.entity_id!))]
    const osRecords = entityIds.length > 0
      ? await prisma.serviceOrder.findMany({
          where: { id: { in: entityIds }, company_id: user.companyId },
          select: { id: true, os_number: true, customers: { select: { legal_name: true } } },
        })
      : []
    const osMap = new Map(osRecords.map(o => [o.id, { number: o.os_number, customer: o.customers?.legal_name || '' }]))

    const data = logs.map((log) => {
      const type = inferType(log.action, log.module)
      if (typeFilter && type !== typeFilter) return null

      const userName = log.user_id === 'portal' ? 'Cliente (Portal)'
        : log.user_id === 'system' ? 'Sistema'
        : log.user_id?.startsWith('BOT') ? 'Bot IA'
        : userMap.get(log.user_id) || log.user_id

      const osInfo = log.entity_id ? osMap.get(log.entity_id) : null

      return {
        id: log.id,
        type,
        module: log.module,
        action: log.action,
        entity_id: log.entity_id,
        os_number: osInfo?.number || null,
        customer_name: osInfo?.customer || (log.new_value as any)?.customer_name || (log.new_value as any)?.nome || null,
        user_id: log.user_id,
        user_name: userName,
        description: buildDescription(log, userName, osInfo),
        old_value: log.old_value,
        new_value: log.new_value,
        ip_address: (log as any).ip_address || null,
        timestamp: log.created_at,
      }
    }).filter(Boolean)

    return success({ logs: data })
  } catch (err) {
    return handleError(err)
  }
}

function inferType(action: string, module: string): string {
  const a = action.toLowerCase()
  if (a.includes('approv') || a.includes('aprovad')) return 'approval'
  if (a.includes('reject') || a.includes('recusad') || a.includes('negad')) return 'rejection'
  if (a.includes('nps')) return 'nps'
  if (a.includes('login') || a.includes('auth')) return 'login'
  if (a.includes('ticket') || a.includes('message')) return 'ticket'
  if (a.includes('transition')) return 'transition'
  if (a.includes('quote') || a.includes('orcamento')) return 'quote'
  if (a.includes('bot')) return 'bot'
  if (a.includes('payment') || a.includes('pagament')) return 'payment'
  if (a.includes('add_item') || a.includes('edit_item') || a.includes('remove_item') || a.includes('apply_kit')) return 'item'
  if (a.includes('create') || a.includes('cri')) return 'create'
  return 'other'
}

function buildDescription(
  log: { action: string; module: string; entity_id: string | null; user_id: string; new_value: unknown; old_value: unknown },
  userName: string,
  osInfo: { number: number; customer: string } | null | undefined
): string {
  const a = log.action.toLowerCase()
  const nv = (log.new_value || {}) as Record<string, any>
  const ov = (log.old_value || {}) as Record<string, any>
  const os = osInfo ? `OS #${osInfo.number}` : (log.entity_id ? `#${log.entity_id.slice(0, 8)}` : '')
  const customer = osInfo?.customer || nv.customer_name || nv.nome || ''

  // Transitions
  if (a.includes('transition') && nv.statusId) {
    return `${userName} mudou o status da ${os}${customer ? ` (${customer})` : ''}`
  }

  // Approvals
  if (a.includes('quote_approved_by_customer')) {
    const valor = nv.approved_cost || nv.total_cost
    return `Cliente ${customer || ''} aprovou o orcamento da ${os}${valor ? ` — ${formatCents(valor)}` : ''}`
  }
  if (a.includes('quote_rejected_by_customer')) {
    return `Cliente ${customer || ''} recusou/negociou o orcamento da ${os}`
  }

  // Items
  if (a.includes('add_item')) return `${userName} adicionou item na ${os}`
  if (a.includes('edit_item')) return `${userName} editou item na ${os}`
  if (a.includes('remove_item')) return `${userName} removeu item da ${os}`
  if (a.includes('apply_kit')) return `${userName} aplicou kit "${nv.kit_name || ''}" na ${os}`

  // OS creation
  if (a.includes('create') && log.module === 'os') return `${userName} abriu a ${os}${customer ? ` para ${customer}` : ''}`

  // Quote sending
  if (a.includes('send') && (a.includes('quote') || a.includes('orcamento'))) return `${userName} enviou orcamento da ${os}`

  // Login
  if (a.includes('login')) return `${userName} fez login no portal`

  // NPS
  if (a.includes('nps')) return `Cliente avaliou o atendimento da ${os}${nv.score ? ` — nota ${nv.score}` : ''}`

  // Payment
  if (a.includes('payment') || a.includes('pagament')) return `Pagamento registrado para ${os}${nv.amount ? ` — ${formatCents(nv.amount)}` : ''}`

  // Ticket
  if (a.includes('ticket')) return `${userName} ${a.includes('create') ? 'abriu' : 'atualizou'} ticket${os ? ` ref. ${os}` : ''}`

  // Generic
  return `${userName} — ${log.action}${os ? ` (${os})` : ''}`
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}
