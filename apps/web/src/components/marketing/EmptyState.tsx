'use client'

import { type LucideIcon, Inbox } from 'lucide-react'

interface Props {
  icon?: LucideIcon
  title: string
  description?: string
  action?: { label: string; href?: string; onClick?: () => void }
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-800/50">
      <div className="rounded-full bg-gray-100 p-3 dark:bg-gray-700/50">
        <Icon className="h-7 w-7 text-gray-400" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">{description}</p>
      )}
      {action && (
        action.href ? (
          <a
            href={action.href}
            className="mt-4 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            {action.label}
          </a>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-4 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  )
}
