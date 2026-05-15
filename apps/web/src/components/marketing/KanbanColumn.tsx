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
}

export function KanbanColumn({ stage, contacts, total, loading = false }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.key,
    data: { stage: stage.key },
  })

  const showOverflow = total > contacts.length

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
          <span className="tabular-nums text-xs font-medium text-gray-500 dark:text-gray-400">
            {formatNumber(total)}
          </span>
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
          contacts.map(c => <KanbanCard key={c.id} contact={c} stage={stage.key} />)
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
