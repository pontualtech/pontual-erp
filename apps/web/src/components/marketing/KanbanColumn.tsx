'use client'

import { useDroppable } from '@dnd-kit/core'
import { type StageDefinition, stageHeaderClasses, stageDotClasses } from '@/lib/marketing/stages'
import { formatNumber } from '@/lib/marketing/format'
import { KanbanCard, type KanbanContact } from './KanbanCard'

interface Props {
  stage: StageDefinition
  /** Contatos a renderizar (já limitados — máx 50) */
  contacts: KanbanContact[]
  /** Total real na coluna (pode ser maior que contacts.length se truncado) */
  total: number
  loading?: boolean
  /** ids selecionados (multi-select) — passa Set pra ter O(1) lookup */
  selectedIds?: Set<string>
  /** callback de toggle (pra KanbanCard repassar) */
  onToggleSelect?: (id: string, modifiers: { shift: boolean; meta: boolean }) => void
}

export function KanbanColumn({ stage, contacts, total, loading = false, selectedIds, onToggleSelect }: Props) {
  const anySelected = !!selectedIds && selectedIds.size > 0
  const { setNodeRef, isOver } = useDroppable({
    id: stage.key,
    data: { stage: stage.key },
  })

  const showOverflow = total > contacts.length

  /** Quantos cards desta coluna estão na seleção atual */
  const selectedInColumn = selectedIds
    ? contacts.reduce((n, c) => n + (selectedIds.has(c.id) ? 1 : 0), 0)
    : 0

  /** Última atividade dentre os contatos visíveis (heurística — só top-50) */
  const lastActivityMs = contacts.reduce((acc, c) => {
    const t = c.last_seen_at ? new Date(c.last_seen_at).getTime() : 0
    return t > acc ? t : acc
  }, 0)
  const daysSinceActivity = lastActivityMs > 0
    ? Math.floor((Date.now() - lastActivityMs) / (1000 * 60 * 60 * 24))
    : null

  let activityDotClass = 'bg-gray-300 dark:bg-gray-600'
  let activityTitle = 'Sem atividade'
  if (daysSinceActivity !== null) {
    if (daysSinceActivity <= 7) {
      activityDotClass = 'bg-green-500'
      activityTitle = `Última atividade há ${daysSinceActivity}d`
    } else if (daysSinceActivity <= 30) {
      activityDotClass = 'bg-amber-500'
      activityTitle = `Última atividade há ${daysSinceActivity}d`
    } else {
      activityDotClass = 'bg-gray-400 dark:bg-gray-500'
      activityTitle = `Última atividade há ${daysSinceActivity}d`
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full min-w-[280px] flex-1 flex-col rounded-xl border-2 transition ${
        isOver ? 'border-blue-400 bg-blue-50/40 dark:border-blue-500 dark:bg-blue-500/5' : 'border-transparent'
      }`}
    >
      <div className={`rounded-t-lg border-b-2 px-3 py-2.5 ${stageHeaderClasses(stage.color)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${stageDotClasses(stage.color)}`} />
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {stage.emoji} {stage.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {selectedInColumn > 0 && (
              <span
                className="inline-flex items-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                title={`${selectedInColumn} selecionado${selectedInColumn === 1 ? '' : 's'} nesta coluna`}
              >
                +{selectedInColumn}
              </span>
            )}
            <span
              className={`h-1.5 w-1.5 rounded-full ${activityDotClass}`}
              title={`${activityTitle} (heurística sobre top ${contacts.length})`}
            />
            <span className="tabular-nums text-xs font-medium text-gray-500 dark:text-gray-400">
              {formatNumber(total)}
            </span>
          </div>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400" title={stage.description}>
          {stage.description}
        </p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-gray-50/40 p-2 dark:bg-gray-900/20">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-300 text-xs text-gray-400 dark:border-gray-700">
            Solte um contato aqui
          </div>
        ) : (
          contacts.map(c => (
            <KanbanCard
              key={c.id}
              contact={c}
              stage={stage.key}
              selected={selectedIds?.has(c.id)}
              anySelected={anySelected}
              onToggleSelect={onToggleSelect}
            />
          ))
        )}

        {showOverflow && (
          <div className="rounded-lg bg-gray-100 px-3 py-2 text-center text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            + {formatNumber(total - contacts.length)} contatos não exibidos
          </div>
        )}
      </div>
    </div>
  )
}
