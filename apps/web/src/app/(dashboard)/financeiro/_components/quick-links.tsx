'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LinkItem {
  label: string
  href: string
  icon: LucideIcon
  desc: string
  tone: 'purple' | 'blue' | 'emerald' | 'amber' | 'pink' | 'violet' | 'cyan' | 'indigo' | 'rose' | 'teal' | 'orange' | 'sky' | 'slate'
}

interface Props {
  title: string
  items: LinkItem[]
  // Default expanded? Padrão fechado pra não poluir
  defaultOpen?: boolean
}

const toneClasses: Record<LinkItem['tone'], string> = {
  purple:  'text-purple-600 bg-purple-50',
  blue:    'text-blue-600 bg-blue-50',
  emerald: 'text-emerald-600 bg-emerald-50',
  amber:   'text-amber-600 bg-amber-50',
  pink:    'text-pink-600 bg-pink-50',
  violet:  'text-violet-600 bg-violet-50',
  cyan:    'text-cyan-600 bg-cyan-50',
  indigo:  'text-indigo-600 bg-indigo-50',
  rose:    'text-rose-600 bg-rose-50',
  teal:    'text-teal-600 bg-teal-50',
  orange:  'text-orange-600 bg-orange-50',
  sky:     'text-sky-600 bg-sky-50',
  slate:   'text-slate-600 bg-slate-100',
}

// Accordion compacto pra cadastros/relatórios — reduz "wall of icons"
// que ocupava 2 grids enormes no design anterior.
export function QuickLinks({ title, items, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section>
      <button
        onClick={() => setOpen(!open)}
        className="group flex w-full cursor-pointer items-center justify-between rounded-lg px-1 py-2 text-left transition-colors hover:bg-gray-50"
        aria-expanded={open}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">{title}</h2>
          <span className="text-xs text-gray-400 tabular-nums">{items.length}</span>
        </div>
        <ChevronDown
          className={cn('h-4 w-4 text-gray-400 transition-transform duration-200', open ? 'rotate-180' : '')}
        />
      </button>

      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-all hover:-translate-y-px hover:border-gray-300 hover:shadow-sm"
              >
                <div className={cn('flex h-8 w-8 flex-none items-center justify-center rounded-md transition-colors', toneClasses[item.tone])}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                  <p className="truncate text-xs text-gray-500">{item.desc}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
