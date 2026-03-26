'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Plus, Search, List, LayoutGrid } from 'lucide-react'

interface KanbanColumn {
  id: string
  name: string
  color: string
  order: number
  items: OS[]
}

interface OS {
  id: string
  os_number: number
  customer_id: string | null
  status_id: string
  priority: string
  os_type: string
  equipment_type: string | null
  equipment_brand: string | null
  equipment_model: string | null
  reported_issue: string | null
  created_at: string
  customers: { id: string; legal_name: string; phone: string | null } | null
}

const priorityLabel: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const priorityColor: Record<string, string> = {
  LOW: 'text-gray-500',
  MEDIUM: 'text-blue-500',
  HIGH: 'text-orange-500',
  URGENT: 'text-red-600 font-semibold',
}

export default function OSListPage() {
  const [osList, setOsList] = useState<OS[]>([])
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, { name: string; color: string }>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [view, setView] = useState<'table' | 'kanban'>('table')

  // Load status definitions from kanban endpoint
  useEffect(() => {
    fetch('/api/os/kanban')
      .then(r => r.json())
      .then(d => {
        const cols: KanbanColumn[] = d.data ?? []
        setKanbanColumns(cols)
        const map: Record<string, { name: string; color: string }> = {}
        cols.forEach(col => { map[col.id] = { name: col.name, color: col.color } })
        setStatusMap(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    if (statusFilter) params.set('statusId', statusFilter)
    fetch(`/api/os?${params}`)
      .then(r => r.json())
      .then(d => {
        setOsList(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [search, statusFilter, page])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Ordens de Servico</h1>
        <Link
          href="/os/novo"
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Nova OS
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            placeholder="Buscar por numero, cliente, equipamento..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">Todos os status</option>
          {kanbanColumns.map(col => (
            <option key={col.id} value={col.id}>{col.name}</option>
          ))}
        </select>
        <div className="flex rounded-md border bg-white">
          <button onClick={() => setView('table')} className={cn('p-2', view === 'table' && 'bg-gray-100')}>
            <List className="h-4 w-4" />
          </button>
          <button onClick={() => setView('kanban')} className={cn('p-2', view === 'kanban' && 'bg-gray-100')}>
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <>
          {/* Table view */}
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                  <th className="px-4 py-3">Numero</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Equipamento</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Prioridade</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
                ) : osList.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nenhuma OS encontrada</td></tr>
                ) : (
                  osList.map(os => {
                    const st = statusMap[os.status_id]
                    return (
                      <tr key={os.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link href={`/os/${os.id}`} className="font-medium text-blue-600 hover:underline">
                            OS-{String(os.os_number).padStart(4, '0')}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{os.customers?.legal_name ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-700">{os.equipment_type ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={st ? { backgroundColor: st.color + '20', color: st.color } : {}}
                          >
                            {st?.name ?? os.status_id}
                          </span>
                        </td>
                        <td className={cn('px-4 py-3 text-xs', priorityColor[os.priority])}>
                          {priorityLabel[os.priority] ?? os.priority}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{os.os_type}</td>
                        <td className="px-4 py-3 text-gray-500">
                          {new Date(os.created_at).toLocaleDateString('pt-BR')}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Proxima
              </button>
            </div>
          )}
        </>
      ) : (
        /* Kanban view */
        <div className="flex gap-4 overflow-x-auto pb-4">
          {kanbanColumns.map(col => (
            <div key={col.id} className="min-w-[280px] max-w-[320px] flex-shrink-0">
              <div className="mb-2 flex items-center gap-2 rounded-t-lg px-3 py-2" style={{ backgroundColor: col.color + '15' }}>
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: col.color }} />
                <span className="text-sm font-semibold" style={{ color: col.color }}>{col.name}</span>
                <span className="ml-auto text-xs text-gray-400">{col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-gray-400">Nenhuma OS</p>
                ) : col.items.map(os => (
                  <Link
                    key={os.id}
                    href={`/os/${os.id}`}
                    className="block rounded-lg border bg-white p-3 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">OS-{String(os.os_number).padStart(4, '0')}</span>
                      <span className={cn('text-xs', priorityColor[os.priority])}>
                        {priorityLabel[os.priority] ?? os.priority}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{os.customers?.legal_name ?? 'Sem cliente'}</p>
                    {os.equipment_type && <p className="mt-0.5 text-xs text-gray-400">{os.equipment_type}</p>}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
