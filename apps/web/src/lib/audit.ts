import { prisma } from '@pontual/db'

/**
 * Registra ação no audit log (fire-and-forget, não bloqueia)
 */
export function logAudit(params: {
  companyId: string
  userId: string
  module: string
  action: string
  entityId?: string
  oldValue?: Record<string, unknown>
  newValue?: Record<string, unknown>
}) {
  // Fire-and-forget — não bloqueia a response
  prisma.auditLog.create({
    data: {
      company_id: params.companyId,
      user_id: params.userId,
      module: params.module,
      action: params.action,
      entity_id: params.entityId ?? null,
      old_value: params.oldValue ? JSON.parse(JSON.stringify(params.oldValue)) : undefined,
      new_value: params.newValue ? JSON.parse(JSON.stringify(params.newValue)) : undefined,
    },
  }).catch(err => {
    console.error('[AUDIT] Failed to log:', err)
  })
}
