'use client'

import { useEffect, useState } from 'react'
import { Loader2, Clock, User as UserIcon } from 'lucide-react'

/**
 * UX-6 #5: timeline universal de auditoria por entidade.
 * Consome `/api/audit-logs?entity_id=X` e renderiza visualmente.
 *
 * Uso:
 *   <EntityTimeline entityType="os" entityId={os.id} title="Histórico" />
 *
 * Próximo passo (Sprint UX-6b): timeline UNIFICADA combinando:
 *  - audit_logs (mudança de campo)
 *  - service_order_history (transição de status)
 *  - voip_calls (chamadas)
 *  - chatwoot_messages (whatsapp)
 *  - email_log (emails)
 * num único endpoint /api/os/[id]/timeline.
 */
type AuditEntry = {
  id: string
  action: string
  module: string
  entity_id: string | null
  user_id: string | null
  user_name?: string | null
  old_value: any
  new_value: any
  metadata: any
  created_at: string
}

export function EntityTimeline({
  entityId,
  entityType,
  title = 'Histórico de alterações',
  limit = 30,
}: {
  entityId: string
  entityType?: string
  title?: string
  limit?: number
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entityId) return
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ entity_id: entityId, limit: String(limit) })
    if (entityType) params.set('module', entityType)
    fetch(`/api/audit-logs?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled) return
        if (json?.data) setEntries(json.data)
        else setError('Sem permissão para ver histórico')
      })
      .catch(() => { if (!cancelled) setError('Erro ao carregar histórico') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entityId, entityType, limit])

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
    </div>
  )

  if (error) return (
    <p className="text-xs text-gray-400 italic py-2">{error}</p>
  )

  if (entries.length === 0) return (
    <p className="text-xs text-gray-400 italic py-2">Nenhuma alteração registrada ainda.</p>
  )

  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Clock className="h-4 w-4 text-blue-600" />
          {title}
          <span className="text-[10px] text-gray-400 font-normal">({entries.length})</span>
        </h3>
      )}
      <ol className="space-y-2 border-l-2 border-gray-200 dark:border-zinc-700 pl-4">
        {entries.map((e) => (
          <li key={e.id} className="relative">
            <span className="absolute -left-[1.4rem] top-1.5 w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-white dark:ring-zinc-900" aria-hidden />
            <div className="text-xs">
              <span className="font-semibold text-gray-800 dark:text-gray-200">{e.action.replace(/_/g, ' ')}</span>
              {' · '}
              <span className="text-gray-600 dark:text-gray-400 inline-flex items-center gap-1">
                <UserIcon className="h-3 w-3" />
                {e.user_name || e.user_id?.slice(0, 8) || 'sistema'}
              </span>
              {' · '}
              <time className="text-gray-400 dark:text-gray-500" dateTime={e.created_at}>
                {new Date(e.created_at).toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </time>
            </div>
            {(e.old_value || e.new_value) && (
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
                {e.old_value && Object.keys(e.old_value).length > 0 && (
                  <div className="line-through opacity-60">
                    {Object.entries(e.old_value).slice(0, 3).map(([k, v]) => (
                      <span key={k} className="inline-block mr-2">
                        <code className="font-mono">{k}</code>={String(v).slice(0, 30)}
                      </span>
                    ))}
                  </div>
                )}
                {e.new_value && Object.keys(e.new_value).length > 0 && (
                  <div className="text-emerald-600 dark:text-emerald-400">
                    {Object.entries(e.new_value).slice(0, 3).map(([k, v]) => (
                      <span key={k} className="inline-block mr-2">
                        <code className="font-mono">{k}</code>={String(v).slice(0, 30)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
