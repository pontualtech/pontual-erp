'use client'

import Link from 'next/link'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Mail, MousePointerClick, MailX, GripVertical } from 'lucide-react'
import { ContactAvatar } from './ContactAvatar'
import { TagList } from './TagBadge'
import { formatRelative } from '@/lib/marketing/format'

export interface KanbanContact {
  id: string
  email: string
  name: string | null
  tags: string[]
  unsubscribed: boolean
  bounce_count: number
  last_opened_at: string | null
  last_clicked_at: string | null
  last_seen_at: string | null
}

interface Props {
  contact: KanbanContact
  /** stage atual deste card (pra identificar origem no drag) */
  stage: string
  /** multi-select: true se card está selecionado */
  selected?: boolean
  /** quantos cards estão selecionados no board todo (mostra checkbox sempre se >0) */
  anySelected?: boolean
  /** callback de toggle. Recebe modifierKeys pra suportar shift+click range select */
  onToggleSelect?: (id: string, modifiers: { shift: boolean; meta: boolean }) => void
}

export function KanbanCard({ contact, stage, selected, anySelected, onToggleSelect }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: contact.id,
    data: { stage, contact },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  }

  function handleCheckboxClick(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    onToggleSelect?.(contact.id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group select-none rounded-lg border bg-white p-3 shadow-sm transition hover:shadow-md dark:bg-gray-800 ${
        selected
          ? 'border-blue-500 ring-1 ring-blue-500/30 dark:border-blue-400'
          : 'border-gray-200 dark:border-gray-700'
      } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-2">
        {/* Checkbox: sempre visível se algum selecionado OU em hover; clicável sem ativar drag */}
        {onToggleSelect && (
          <label
            className={`flex shrink-0 cursor-pointer items-center justify-center mt-0.5 transition ${
              selected || anySelected
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            }`}
            onPointerDown={e => e.stopPropagation()}
            onClick={handleCheckboxClick}
          >
            <input
              type="checkbox"
              checked={!!selected}
              readOnly
              className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </label>
        )}
        <ContactAvatar name={contact.name} email={contact.email} size="sm" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/marketing/contatos/${contact.id}`}
            onClick={e => e.stopPropagation()}
            className="block truncate text-sm font-medium text-gray-900 hover:text-blue-600 dark:text-gray-100"
            onPointerDown={e => e.stopPropagation()}
          >
            {contact.name || contact.email}
          </Link>
          <div className="truncate text-[11px] text-gray-500">{contact.email}</div>
        </div>
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-gray-300 opacity-0 transition group-hover:opacity-100" />
      </div>

      <div className="mt-2">
        <TagList tags={contact.tags} max={3} size="sm" showEmoji={false} />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
        <span title={`Último sinal: ${contact.last_seen_at || 'nunca'}`}>
          {formatRelative(contact.last_seen_at)}
        </span>
        <div className="flex items-center gap-1.5">
          {contact.last_opened_at && <Mail className="h-3 w-3 text-blue-500" />}
          {contact.last_clicked_at && <MousePointerClick className="h-3 w-3 text-purple-500" />}
          {contact.bounce_count > 0 && (
            <span className="rounded bg-rose-50 px-1 text-[10px] font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              B{contact.bounce_count}
            </span>
          )}
          {contact.unsubscribed && <MailX className="h-3 w-3 text-orange-500" />}
        </div>
      </div>
    </div>
  )
}
