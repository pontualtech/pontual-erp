'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Plus, Search, List, LayoutGrid, Settings2, Eye, EyeOff, Trash2, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Clock, AlertTriangle, Printer, FileSpreadsheet, Mail, Columns3 } from 'lucide-react'
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
  total_cost: number | null
  approved_cost: number | null
  estimated_delivery: string | null
  actual_delivery: string | null
  created_at: string
  customers: { id: string; legal_name: string; phone: string | null } | null
  user_profiles: { id: string; name: string } | null
  accounts_receivable: { id: string; status: string; total_amount: number; received_amount: number | null }[]
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function getFinanceStatus(os: OS) {
  const ar = os.accounts_receivable?.[0]
  if (!ar) return null
  if (ar.status === 'RECEBIDO' || ar.status === 'PAGO') return { label: 'Pago', color: 'bg-green-100 text-green-700' }
  if (ar.status === 'CANCELADO') return { label: 'Cancelado', color: 'bg-gray-100 text-gray-500' }
  const now = new Date()
  // Vencido se passou da data
  return { label: 'Pendente', color: 'bg-amber-100 text-amber-700' }
}

function isOverdue(os: OS) {
  if (!os.estimated_delivery || os.actual_delivery) return false
  return new Date(os.estimated_delivery) < new Date()
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
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [totalFiltered, setTotalFiltered] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set())
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [sortField, setSortField] = useState<string>('os_number')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [overdueFilter, setOverdueFilter] = useState(false)
  const [allowedColumns, setAllowedColumns] = useState<string[]>([])
  const [ownOnly, setOwnOnly] = useState(false)
  const [visibilityLoaded, setVisibilityLoaded] = useState(false)
  const [hiddenByUser, setHiddenByUser] = useState<Set<string>>(new Set())
  const [showColToggle, setShowColToggle] = useState(false)
  const [showStatusFilter, setShowStatusFilter] = useState(false)

  // Load role-based visibility config
  useEffect(() => {
    if (isAdmin) {
      setAllowedColumns(['os_number', 'created_at', 'customer', 'equipment_type', 'status', 'total_cost', 'financeiro', 'technician', 'priority'])
      setOwnOnly(false)
      setVisibilityLoaded(true)
      return
    }
    fetch('/api/os/visibility')
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setAllowedColumns(d.data.columns ?? [])
          setOwnOnly(d.data.own_only ?? false)
        }
      })
      .catch(() => {
        setAllowedColumns(['os_number', 'created_at', 'customer', 'equipment_type', 'status', 'technician', 'priority'])
      })
      .finally(() => setVisibilityLoaded(true))
  }, [isAdmin])

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
    if (!visibilityLoaded) return
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    if (statusFilter.length === 1) params.set('statusId', statusFilter[0])
    else if (statusFilter.length > 1) statusFilter.forEach(s => params.append('statusId', s))
    if (overdueFilter) params.set('overdue', 'true')
    if (ownOnly) params.set('own_only', 'true')
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    fetch(`/api/os?${params}`)
      .then(r => r.json())
      .then(d => {
        setOsList(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
        setTotalFiltered(d.total ?? 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadOS(); setSelected(new Set()) }, [search, statusFilter, overdueFilter, page, visibilityLoaded, ownOnly, dateFrom, dateTo])

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    if (selected.size === osList.length) setSelected(new Set())
    else setSelected(new Set(osList.map(os => os.id)))
  }

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'os_number' || field === 'created_at' ? 'desc' : 'asc')
    }
  }

  function getSortedList() {
    return [...osList].sort((a, b) => {
      let va: any, vb: any
      switch (sortField) {
        case 'os_number': va = a.os_number; vb = b.os_number; break
        case 'created_at': va = a.created_at; vb = b.created_at; break
        case 'customer': va = a.customers?.legal_name || ''; vb = b.customers?.legal_name || ''; break
        case 'equipment_type': va = a.equipment_type || ''; vb = b.equipment_type || ''; break
        case 'equipment_brand': va = a.equipment_brand || ''; vb = b.equipment_brand || ''; break
        case 'equipment_model': va = a.equipment_model || ''; vb = b.equipment_model || ''; break
        case 'status': va = statusMap[a.status_id]?.name || ''; vb = statusMap[b.status_id]?.name || ''; break
        case 'technician': va = a.user_profiles?.name || ''; vb = b.user_profiles?.name || ''; break
        case 'priority': { const o: Record<string, number> = {URGENT:0,HIGH:1,MEDIUM:2,LOW:3}; va = o[a.priority]??9; vb = o[b.priority]??9; break }
        case 'os_type': va = a.os_type; vb = b.os_type; break
        default: va = a.os_number; vb = b.os_number
      }
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb as string).toLowerCase() }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
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

  // Load user column preferences from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('os_hidden_columns')
      if (saved) setHiddenByUser(new Set(JSON.parse(saved)))
    } catch {}
  }, [])

  function toggleUserColumn(key: string) {
    setHiddenByUser(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      localStorage.setItem('os_hidden_columns', JSON.stringify([...next]))
      return next
    })
  }

  // Effective visible columns = allowed by role - hidden by user
  const effectiveColumns = allowedColumns.filter(c => !hiddenByUser.has(c))

  const allColumnLabels: Record<string, string> = {
    os_number: 'Nº', created_at: 'Data', customer: 'Cliente', equipment_type: 'Equip.',
    status: 'Status', total_cost: 'Valor', financeiro: 'Financeiro', technician: 'Técnico', priority: 'Prioridade',
  }

  // Export selected OS to CSV
  function exportCSV() {
    const selectedOS = osList.filter(os => selected.has(os.id))
    if (selectedOS.length === 0) { toast.error('Selecione pelo menos uma OS'); return }

    const headers = effectiveColumns.map(c => allColumnLabels[c] || c)
    const rows = selectedOS.map(os => effectiveColumns.map(col => {
      const st = statusMap[os.status_id]
      switch (col) {
        case 'os_number': return `OS-${String(os.os_number).padStart(4, '0')}`
        case 'created_at': return new Date(os.created_at).toLocaleDateString('pt-BR')
        case 'customer': return os.customers?.legal_name || ''
        case 'equipment_type': return os.equipment_type || ''
        case 'status': return st?.name || ''
        case 'total_cost': return ((os.total_cost || 0) / 100).toFixed(2)
        case 'financeiro': return getFinanceStatus(os)?.label || ''
        case 'technician': return os.user_profiles?.name || ''
        case 'priority': return priorityLabel[os.priority] || os.priority
        default: return ''
      }
    }))

    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `os-selecionadas-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${selectedOS.length} OS exportadas para CSV`)
  }

  // Print selected OS
  function printOS() {
    const selectedOS = osList.filter(os => selected.has(os.id))
    if (selectedOS.length === 0) { toast.error('Selecione pelo menos uma OS'); return }

    const headers = effectiveColumns.map(c => allColumnLabels[c] || c)
    const rows = selectedOS.map(os => {
      const st = statusMap[os.status_id]
      return effectiveColumns.map(col => {
        switch (col) {
          case 'os_number': return `OS-${String(os.os_number).padStart(4, '0')}`
          case 'created_at': return new Date(os.created_at).toLocaleDateString('pt-BR')
          case 'customer': return os.customers?.legal_name || ''
          case 'equipment_type': return os.equipment_type || ''
          case 'status': return st?.name || ''
          case 'total_cost': return fmt(os.total_cost || 0)
          case 'financeiro': return getFinanceStatus(os)?.label || ''
          case 'technician': return os.user_profiles?.name || ''
          case 'priority': return priorityLabel[os.priority] || os.priority
          default: return ''
        }
      })
    })

    const html = `<html><head><title>OS Selecionadas</title><style>
      body{font-family:Arial,sans-serif;padding:20px}
      h1{font-size:16px;margin-bottom:10px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
      th{background:#f5f5f5;font-weight:bold}
      @media print{button{display:none}}
    </style></head><body>
    <h1>PontualTech — ${selectedOS.length} OS Selecionadas (${new Date().toLocaleDateString('pt-BR')})</h1>
    <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <script>window.print()</script></body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  // Email selected OS (open mailto with summary)
  function emailOS() {
    const selectedOS = osList.filter(os => selected.has(os.id))
    if (selectedOS.length === 0) { toast.error('Selecione pelo menos uma OS'); return }

    const lines = selectedOS.map(os => {
      const st = statusMap[os.status_id]
      return `OS-${String(os.os_number).padStart(4, '0')} | ${os.customers?.legal_name || 'Sem cliente'} | ${st?.name || ''} | ${(os.total_cost || 0) > 0 ? fmt(os.total_cost || 0) : 'S/ valor'}`
    })

    const subject = encodeURIComponent(`PontualTech — ${selectedOS.length} OS Selecionadas`)
    const body = encodeURIComponent(`Segue lista de OS:\n\n${lines.join('\n')}\n\nGerado em ${new Date().toLocaleString('pt-BR')}`)
    window.open(`mailto:?subject=${subject}&body=${body}`)
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
        {/* Multi-status filter */}
        <div className="relative">
          <button type="button" onClick={() => setShowStatusFilter(!showStatusFilter)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm',
              statusFilter.length > 0 ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white text-gray-600'
            )}>
            Status {statusFilter.length > 0 && `(${statusFilter.length})`}
          </button>
          {showStatusFilter && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowStatusFilter(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 w-56 rounded-lg border bg-white shadow-lg p-1 max-h-64 overflow-y-auto">
                <button type="button" onClick={() => { setStatusFilter([]); setPage(1) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 rounded">Limpar filtros</button>
                {kanbanColumns.map(col => (
                  <button key={col.id} type="button"
                    onClick={() => {
                      setStatusFilter(prev => prev.includes(col.id) ? prev.filter(s => s !== col.id) : [...prev, col.id])
                      setPage(1)
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left',
                      statusFilter.includes(col.id) ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                    )}>
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                    {col.name}
                    {statusFilter.includes(col.id) && <span className="ml-auto text-blue-500">✓</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Date filters */}
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
          title="Data de" placeholder="De" className="rounded-md border bg-white px-2 py-2 text-sm w-32" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
          title="Data ate" placeholder="Ate" className="rounded-md border bg-white px-2 py-2 text-sm w-32" />
        <button type="button"
          onClick={() => { setOverdueFilter(!overdueFilter); setPage(1) }}
          title="Filtrar OS em atraso"
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
            overdueFilter ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white text-gray-600 hover:bg-gray-50'
          )}>
          <AlertTriangle className="h-4 w-4" />
          Em atraso
        </button>
        {/* Column toggle */}
        <div className="relative">
          <button type="button" onClick={() => setShowColToggle(!showColToggle)}
            title="Mostrar/esconder colunas"
            className="flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <Columns3 className="h-4 w-4" /> Colunas
          </button>
          {showColToggle && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowColToggle(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-lg border bg-white shadow-lg p-1">
                {allowedColumns.map(key => (
                  <button key={key} type="button" onClick={() => toggleUserColumn(key)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm text-left',
                      hiddenByUser.has(key) ? 'text-gray-400' : 'text-gray-700 bg-blue-50'
                    )}>
                    {hiddenByUser.has(key) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {allColumnLabels[key] || key}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex rounded-md border bg-white">
          <button type="button" onClick={() => setView('table')} title="Visualização em tabela" className={cn('p-2', view === 'table' && 'bg-gray-100')}>
            <List className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setView('kanban')} title="Visualização kanban" className={cn('p-2', view === 'kanban' && 'bg-gray-100')}>
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Counter */}
      {!loading && (
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="font-medium">{totalFiltered} OS{totalFiltered !== 1 ? 's' : ''}</span>
          {(statusFilter.length > 0 || dateFrom || dateTo || overdueFilter || search) && (
            <button type="button" onClick={() => { setStatusFilter([]); setDateFrom(''); setDateTo(''); setOverdueFilter(false); setSearch(''); setPage(1) }}
              className="text-xs text-blue-600 hover:underline">Limpar filtros</button>
          )}
        </div>
      )}

      {ownOnly && !isAdmin && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Exibindo apenas suas OS atribuidas.
        </div>
      )}

      {view === 'table' ? (
        <>
          {/* Table view */}
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" title="Selecionar todos"
                      checked={osList.length > 0 && selected.size === osList.length}
                      onChange={toggleAll} className="rounded text-blue-600" />
                  </th>
                  {[
                    { key: 'os_number', label: 'Nº' },
                    { key: 'created_at', label: 'Data' },
                    { key: 'customer', label: 'Cliente' },
                    { key: 'equipment_type', label: 'Equip.' },
                    { key: 'status', label: 'Status' },
                    { key: 'total_cost', label: 'Valor' },
                    { key: 'financeiro', label: 'Financeiro' },
                    { key: 'technician', label: 'Técnico' },
                    { key: 'priority', label: 'Prioridade' },
                  ].filter(col => effectiveColumns.includes(col.key)).map(col => (
                    <th key={col.key} className="px-4 py-3">
                      <button type="button" onClick={() => handleSort(col.key)}
                        className="flex items-center gap-1 hover:text-gray-700 transition-colors"
                        title={`Ordenar por ${col.label}`}>
                        {col.label} <SortIcon field={col.key} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={effectiveColumns.length + (isAdmin ? 1 : 0)} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
                ) : osList.length === 0 ? (
                  <tr><td colSpan={effectiveColumns.length + (isAdmin ? 1 : 0)} className="px-4 py-8 text-center text-gray-400">{overdueFilter ? 'Nenhuma OS em atraso' : 'Nenhuma OS encontrada'}</td></tr>
                ) : (
                  getSortedList().map(os => {
                    const st = statusMap[os.status_id]
                    return (
                      <tr key={os.id} className={cn(
                        'hover:bg-gray-50',
                        selected.has(os.id) && 'bg-blue-50',
                        isOverdue(os) && 'bg-red-50/50',
                      )}>
                        <td className="px-3 py-3">
                          <input type="checkbox" title={`Selecionar OS-${String(os.os_number).padStart(4, '0')}`}
                            checked={selected.has(os.id)} onChange={() => toggleSelect(os.id)}
                            className="rounded text-blue-600" />
                        </td>
                        {effectiveColumns.includes('os_number') && (
                          <td className="px-4 py-3">
                            <Link href={`/os/${os.id}`} className="font-medium text-blue-600 hover:underline">
                              OS-{String(os.os_number).padStart(4, '0')}
                            </Link>
                          </td>
                        )}
                        {effectiveColumns.includes('created_at') && (
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {new Date(os.created_at).toLocaleDateString('pt-BR')}
                          </td>
                        )}
                        {effectiveColumns.includes('customer') && (
                          <td className="px-4 py-3 text-gray-700 text-xs">{os.customers?.legal_name ?? '—'}</td>
                        )}
                        {effectiveColumns.includes('equipment_type') && (
                          <td className="px-4 py-3 text-gray-700 text-xs">{os.equipment_type ?? '—'}</td>
                        )}
                        {effectiveColumns.includes('status') && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="rounded-full px-2 py-0.5 text-xs font-medium"
                                style={st ? { backgroundColor: st.color + '20', color: st.color } : {}}
                              >
                                {st?.name ?? os.status_id}
                              </span>
                              {isOverdue(os) && (
                                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-600 flex items-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" /> Atraso
                                </span>
                              )}
                            </div>
                          </td>
                        )}
                        {effectiveColumns.includes('total_cost') && (
                          <td className="px-4 py-3 text-right text-xs font-medium text-gray-900">
                            {(os.total_cost || 0) > 0 ? fmt(os.total_cost || 0) : '—'}
                          </td>
                        )}
                        {effectiveColumns.includes('financeiro') && (
                          <td className="px-4 py-3">
                            {(() => {
                              const fin = getFinanceStatus(os)
                              if (!fin) return <span className="text-xs text-gray-400">—</span>
                              return (
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', fin.color)}>
                                  {fin.label}
                                </span>
                              )
                            })()}
                          </td>
                        )}
                        {effectiveColumns.includes('technician') && (
                          <td className="px-4 py-3 text-gray-500 text-xs">{os.user_profiles?.name ?? '—'}</td>
                        )}
                        {effectiveColumns.includes('priority') && (
                          <td className={cn('px-4 py-3 text-xs', priorityColor[os.priority])}>
                            {priorityLabel[os.priority] ?? os.priority}
                          </td>
                        )}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Selection bar */}
          {selected.size > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2">
              <span className="text-sm text-blue-700 font-medium">{selected.size} selecionado(s)</span>
              <div className="flex gap-2">
                <button type="button" onClick={printOS} title="Imprimir selecionadas"
                  className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-gray-600">
                  <Printer className="h-3.5 w-3.5" /> Imprimir
                </button>
                <button type="button" onClick={exportCSV} title="Exportar para planilha"
                  className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-gray-600">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
                </button>
                <button type="button" onClick={emailOS} title="Enviar por email"
                  className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-gray-600">
                  <Mail className="h-3.5 w-3.5" /> Email
                </button>
                <button type="button" onClick={() => setSelected(new Set())}
                  className="text-sm text-gray-500 hover:text-gray-700">Limpar</button>
                {isAdmin && (
                  <button type="button" onClick={() => setShowBulkDelete(true)}
                    className="flex items-center gap-1.5 px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 font-medium">
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </button>
                )}
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
                    <div className="mt-1.5 flex items-center justify-between">
                      {(os.total_cost || 0) > 0 && (
                        <span className="text-xs font-medium text-gray-700">{fmt(os.total_cost || 0)}</span>
                      )}
                      {(() => {
                        const fin = getFinanceStatus(os)
                        if (!fin) return null
                        return <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', fin.color)}>{fin.label}</span>
                      })()}
                      {isOverdue(os) && (
                        <span className="text-[10px] font-medium text-red-600 flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" /> Atraso
                        </span>
                      )}
                    </div>
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
