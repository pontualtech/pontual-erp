'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface OsCard {
  id: string
  os_number: string
  customer_name: string
  equipment: string | null
  priority: string | null
}

interface KanbanColumn {
  id: string
  name: string
  color: string
  sort_order: number
  cards: OsCard[]
}

const priorityBadge: Record<string, string> = {
  URGENTE: 'bg-red-100 text-red-700',
  ALTA: 'bg-orange-100 text-orange-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  BAIXA: 'bg-gray-100 text-gray-500',
}

export default function KanbanPage() {
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/os/kanban')
      .then(r => r.json())
      .then(d => {
        const cols = d.data?.columns ?? d.columns ?? []
        setColumns(
          cols.map((c: any) => ({
            id: c.id ?? c.status,
            name: c.name ?? c.status,
            color: c.color ?? '#6b7280',
            sort_order: c.sort_order ?? c.order ?? 0,
            cards: (c.cards ?? c.items ?? []).map((card: any) => ({
              id: card.id,
              os_number: card.os_number ?? card.number ?? '—',
              customer_name: card.customer_name ?? card.customers?.legal_name ?? '—',
              equipment: card.equipment ?? card.equipment_name ?? null,
              priority: card.priority ?? null,
            })),
          }))
        )
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400">Carregando kanban...</p>
      </div>
    )
  }

  if (columns.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Kanban de OS</h1>
        <div className="rounded-lg border bg-white p-8 text-center text-gray-400 shadow-sm">
          Nenhum status configurado. Configure os status em Configuracoes &gt; Status.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Kanban de OS</h1>
        <Link
          href="/os"
          className="rounded-md border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          Ver lista
        </Link>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: '60vh' }}>
        {columns
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(col => (
            <div
              key={col.id}
              className="flex w-72 flex-shrink-0 flex-col rounded-lg border bg-gray-50 shadow-sm"
            >
              {/* Column header */}
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: col.color }}
                />
                <span className="text-sm font-semibold text-gray-700">{col.name}</span>
                <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {col.cards.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {col.cards.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-400">Nenhuma OS</p>
                ) : (
                  col.cards.map(card => (
                    <Link
                      key={card.id}
                      href={`/os/${card.id}`}
                      className="block rounded-md border bg-white p-3 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-blue-600">#{card.os_number}</span>
                        {card.priority && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityBadge[card.priority] ?? 'bg-gray-100 text-gray-500'}`}>
                            {card.priority}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-700 truncate">{card.customer_name}</p>
                      {card.equipment && (
                        <p className="mt-0.5 text-xs text-gray-400 truncate">{card.equipment}</p>
                      )}
                    </Link>
                  ))
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
