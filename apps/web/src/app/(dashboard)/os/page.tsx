'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Plus, Search, List, LayoutGrid, Settings2, Eye, EyeOff, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/use-auth'

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
  const { isAdmin } = useAuth()
  const [osList, setOsList] = useState<OS[]>([])
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, { name: string; color: string }>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set())
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

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

        // Load saved visible columns from localStorage
        try {
          const saved = localStorage.getItem('kanban_visible_columns')
          if (saved) {
            const parsed = JSON.parse(saved) as string[]
            // Only use saved if at least some match current columns
            const validIds = new Set(cols.map(c => c.id))
            const filtered = parsed.filter(id => validIds.has(id))
            if (filtered.length > 0) {
              setVisibleColumns(new Set(filtered))
              return
            }
          }
        } catch {}
        // Default: show all columns
        setVisibleColumns(new Set(cols.map(c => c.id)))
      })
      .catch(() => {})
  }, [])

  function toggleColumn(id: string) {
    setVisibleColumns(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size > 1) next.delete(id) // Keep at least 1
      } else {
        next.add(id)
      }
      localStorage.setItem('kanban_visible_columns', JSON.stringify([...next]))
      return next
    })
  }

  function selectAllColumns() {
    const all = new Set(kanbanColumns.map(c => c.id))
    setVisibleColumns(all)
    localStorage.setItem('kanban_visible_columns', JSON.stringify([...all]))
  }

  function selectNoneColumns() {
    // Keep first column at minimum
    const first = kanbanColumns[0]?.id
    if (first) {
      const s = new Set([first])
      setVisibleColumns(s)
      localStorage.setItem('kanban_visible_columns', JSON.stringify([...s]))
    }
  }

  function loadOS() {
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
  }

  useEffect(() => { loadOS(); setSelected(new Set()) }, [search, statusFilter, page])

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    if (selected.size === osList.length) setSelected(new Set())
    else setSelected(new Set(osList.map(os => os.id)))
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    let ok = 0, fail = 0
    for (const id of selected) {
      try {
        const res = await fetch(`/api/os/${id}`, { method: 'DELETE' })
        if (res.ok) ok++; else fail++
      } catch { fail++ }
    }
    toast.success(`${ok} OS excluída(s)${fail ? `, ${fail} erro(s)` : ''}`)
    setShowBulkDelete(false); setSelected(new Set()); setBulkDeleting(false); loadOS()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Ordens de Servico</h1>
        <div className="flex items-center gap-2">
          {isAdmin && selected.size > 0 && (
            <button type="button" onClick={() => setShowBulkDelete(true)}
              className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
              <Trash2 className="h-4 w-4" /> Excluir {selected.size}
            </button>
          )}
          <Link
            href="/os/novo"
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Nova OS
          </Link>
        </div>
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
          title="Filtrar por status"
          className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">Todos os status</option>
          {kanbanColumns.map(col => (
            <option key={col.id} value={col.id}>{col.name}</option>
          ))}
        </select>
        <div className="flex rounded-md border bg-white">
          <button type="button" onClick={() => setView('table')} title="Visualização em tabela" className={cn('p-2', view === 'table' && 'bg-gray-100')}>
            <List className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setView('kanban')} title="Visualização kanban" className={cn('p-2', view === 'kanban' && 'bg-gray-100')}>
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
                  {isAdmin && (
                    <th className="px-3 py-3 w-10">
                      <input type="checkbox" title="Selecionar todos"
                        checked={osList.length > 0 && selected.size === osList.length}
                        onChange={toggleAll} className="rounded text-blue-600" />
                    </th>
                  )}
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
                  <tr><td colSpan={isAdmin ? 8 : 7} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
                ) : osList.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 8 : 7} className="px-4 py-8 text-center text-gray-400">Nenhuma OS encontrada</td></tr>
                ) : (
                  osList.map(os => {
                    const st = statusMap[os.status_id]
                    return (
                      <tr key={os.id} className={`hover:bg-gray-50 ${selected.has(os.id) ? 'bg-blue-50' : ''}`}>
                        {isAdmin && (
                          <td className="px-3 py-3">
                            <input type="checkbox" title={`Selecionar OS-${String(os.os_number).padStart(4, '0')}`}
                              checked={selected.has(os.id)} onChange={() => toggleSelect(os.id)}
                              className="rounded text-blue-600" />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <Link href={`/os/${os.id}`} className="font-medium text-blue-600 hover:underline">
                            OS-{String(os.os_number).padStart(4, '0')}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{os.customers?.legal_name ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {os.equipment_type ?? '—'}
                          {(os.equipment_brand || os.equipment_model) && (
                            <span className="text-xs text-gray-400 ml-1">
                              {[os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')}
                            </span>
                          )}
                        </td>
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

          {/* Selection bar */}
          {isAdmin && selected.size > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2">
              <span className="text-sm text-blue-700 font-medium">{selected.size} selecionado(s)</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelected(new Set())}
                  className="text-sm text-gray-500 hover:text-gray-700">Limpar seleção</button>
                <button type="button" onClick={() => setShowBulkDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 font-medium">
                  <Trash2 className="h-3.5 w-3.5" /> Excluir selecionados
                </button>
              </div>
            </div>
          )}

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
        <div className="space-y-3">
          {/* Column picker */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <LayoutGrid className="h-4 w-4" />
              <span>{visibleColumns.size} de {kanbanColumns.length} quadros visíveis</span>
            </div>
            <div className="relative">
              <button type="button" onClick={() => setShowColumnPicker(!showColumnPicker)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50 font-medium text-gray-600">
                <Settings2 className="h-4 w-4" /> Quadros
              </button>
              {showColumnPicker && (
                <div className="absolute right-0 top-full mt-1 z-20 w-64 rounded-lg border bg-white shadow-lg">
                  <div className="px-3 py-2 border-b flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">Quadros Visíveis</span>
                    <div className="flex gap-1">
                      <button type="button" onClick={selectAllColumns}
                        className="text-xs text-blue-600 hover:underline">Todos</button>
                      <span className="text-xs text-gray-300">|</span>
                      <button type="button" onClick={selectNoneColumns}
                        className="text-xs text-gray-500 hover:underline">Mínimo</button>
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto p-1">
                    {kanbanColumns.map(col => {
                      const visible = visibleColumns.has(col.id)
                      return (
                        <button key={col.id} type="button" onClick={() => toggleColumn(col.id)}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors',
                            visible ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50'
                          )}>
                          {visible ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
                          <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                          <span className="truncate">{col.name}</span>
                          <span className="ml-auto text-xs text-gray-400">{col.items.length}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

        <div className="flex gap-4 overflow-x-auto pb-4">
          {kanbanColumns.filter(col => visibleColumns.has(col.id)).map(col => (
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
        </div>
      )}

      {/* Close column picker when clicking outside */}
      {showColumnPicker && (
        <div className="fixed inset-0 z-10" onClick={() => setShowColumnPicker(false)} />
      )}

      {/* Bulk delete modal */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBulkDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-red-600 mb-2">Excluir {selected.size} OS?</h2>
            <p className="text-sm text-gray-600 mb-2">Esta ação não pode ser desfeita.</p>
            <p className="text-sm text-gray-500 mb-4">
              {osList.filter(os => selected.has(os.id)).map(os => `OS-${String(os.os_number).padStart(4, '0')}`).join(', ')}
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowBulkDelete(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                {bulkDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {bulkDeleting ? 'Excluindo...' : `Excluir ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
