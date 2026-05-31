'use client'

import Link from 'next/link'
import { AlertCircle, ArrowRight, User } from 'lucide-react'

interface OverdueItem {
  id: string
  description: string
  customerName: string | null
  customerId: string | null
  openCents: number
  dueDate: string
  daysOverdue: number
}

interface Props {
  items: OverdueItem[]
  loading?: boolean
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

// Color band pela severidade do atraso (UX: cor é signal pra triagem rápida)
function ageColor(days: number) {
  if (days >= 60) return { bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-100' }
  if (days >= 30) return { bg: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-100' }
  return { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-100' }
}

export function TopDevedores({ items, loading }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <h2 className="text-base font-semibold text-gray-900">Top vencidos</h2>
        </div>
        <Link
          href="/financeiro/contas-receber?status=vencidos"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          Ver todos
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="divide-y divide-gray-100">
        {loading ? (
          <SkeletonRows />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          items.map((it) => {
            const c = ageColor(it.daysOverdue)
            const href = `/financeiro/contas-receber/${it.id}`
            return (
              <Link
                key={it.id}
                href={href}
                className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50"
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gray-100 text-gray-500">
                  <User className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {it.customerName ?? <span className="italic text-gray-400">Sem cliente</span>}
                  </p>
                  <p className="truncate text-xs text-gray-500">{it.description}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatBRL(it.openCents)}</span>
                  <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset tabular-nums ${c.bg} ${c.text} ${c.ring}`}>
                    {it.daysOverdue}d
                  </span>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-0">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3">
          <div className="h-9 w-9 flex-none rounded-full bg-gray-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-gray-100" />
            <div className="h-2.5 w-24 rounded bg-gray-100" />
          </div>
          <div className="h-3 w-16 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-5 py-10 text-center">
      <svg className="h-8 w-8 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M20 6L9 17l-5-5" />
      </svg>
      <p className="text-sm text-gray-500">Nenhum vencido. Boa!</p>
    </div>
  )
}
