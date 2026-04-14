'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { cn, formatDocument } from '@/lib/utils'
import { Plus, Search, List, LayoutGrid, Settings2, Eye, EyeOff, Trash2, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Clock, AlertTriangle, Printer, FileSpreadsheet, Mail, Columns3, MoreVertical, Copy, Receipt, ChevronDown, RefreshCw, SearchX, Send, UserPlus, Download, Bell, Truck, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { exportToExcel, exportToCSV, exportToPDF } from '@/lib/export-data'
import { useAuth } from '@/lib/use-auth'

interface KanbanColumn {
  id: string
  name: string
  color: string
  order: number
  items: OS[]
  totalCount?: number
}

interface OS {
  id: string
  os_number: number
  customer_id: string | null
  status_id: string
  priority: string
  os_type: string
  os_location: string | null
  equipment_type: string | null
  equipment_brand: string | null
  equipment_model: string | null
  reported_issue: string | null
  total_cost: number | null
  approved_cost: number | null
  estimated_delivery: string | null
  actual_delivery: string | null
  is_warranty: boolean | null
  warranty_os_id: string | null
  created_at: string
  customers: { id: string; legal_name: string; phone: string | null; document_number: string | null } | null
  module_statuses: { id: string; name: string; color: string } | null
  user_profiles: { id: string; name: string } | null
  accounts_receivable: { id: string; status: string; total_amount: number; received_amount: number | null }[]
  invoices: { id: string; invoice_number: number | null; danfe_url: string | null; access_key: string | null }[]
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

function isOverdue(os: OS, statusName?: string) {
  if (!os.estimated_delivery || os.actual_delivery) return false
  const name = (statusName || '').toLowerCase()
  if (name.includes('entreg') || name.includes('cancelad') || name.includes('finaliz')) return false
  return new Date(os.estimated_delivery) < new Date()
}

/** Semáforo de prazo: red (estourado), yellow (<=2 dias), green (ok), null (sem prazo) */
function getDeadlineColor(os: OS, statusName?: string): 'red' | 'yellow' | 'green' | null {
  if (!os.estimated_delivery || os.actual_delivery) return null
  const name = (statusName || '').toLowerCase()
  if (name.includes('entreg') || name.includes('cancelad') || name.includes('finaliz')) return null
  const now = new Date()
  const deadline = new Date(os.estimated_delivery)
  const diffMs = deadline.getTime() - now.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'red'
  if (diffDays <= 2) return 'yellow'
  return 'green'
}

const deadlineStyles = {
  red: { dot: 'bg-red-500', row: 'border-l-4 border-l-red-500 bg-red-50/40' },
  yellow: { dot: 'bg-yellow-400', row: 'border-l-4 border-l-yellow-400 bg-yellow-50/40' },
  green: { dot: 'bg-green-500', row: '' },
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

const defaultOsTypeLabel: Record<string, string> = {
  BALCAO: 'Balcao',
  COLETA: 'Coleta',
}

const osTypeColor: Record<string, string> = {
  BALCAO: 'bg-blue-100 text-blue-700',
  COLETA: 'bg-purple-100 text-purple-700',
  ENTREGA: 'bg-green-100 text-green-700',
  CAMPO: 'bg-amber-100 text-amber-700',
  REMOTO: 'bg-cyan-100 text-cyan-700',
}

export default function OSListPage() {
  const { isAdmin, user: authUser, hasPermission } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const normalizedRole = authUser?.role?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() || ''
  const isTecnico = normalizedRole === 'tecnico'
  const isMotorista = normalizedRole === 'motorista'
  const canCreateOs = hasPermission('os', 'create')
  const [osList, setOsList] = useState<OS[]>([])
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>([])
  const [osTypeLabel, setOsTypeLabel] = useState<Record<string, string>>(defaultOsTypeLabel)
  useEffect(() => {
    fetch('/api/settings/tipos-os').then(r => r.json()).then(d => {
      const tipos = d.data ?? []
      if (tipos.length > 0) {
        const map: Record<string, string> = {}
        tipos.forEach((t: { key: string; label: string }) => { map[t.key] = t.label })
        setOsTypeLabel(map)
      }
    }).catch(() => {})
    fetch('/api/settings/locais-os').then(r => r.json()).then(d => {
      const locais = d.data ?? []
      if (locais.length > 0) {
        const map: Record<string, string> = {}
        locais.forEach((l: { key: string; label: string }) => { map[l.key] = l.label })
        setOsLocationLabel(map)
      }
    }).catch(() => {})
    fetch('/api/settings/equipamentos-os').then(r => r.json()).then(d => setEquipTypes(d.data ?? [])).catch(() => {})
  }, [])
  const [statusMap, setStatusMap] = useState<Record<string, { name: string; color: string }>>({})
  const [loading, setLoading] = useState(true)

  // Restore filters: sessionStorage (robust) > URL params > defaults
  const saved = useRef<Record<string, string>>({})
  if (typeof window !== 'undefined' && Object.keys(saved.current).length === 0) {
    try {
      const raw = sessionStorage.getItem('os_filters')
      if (raw) saved.current = JSON.parse(raw)
    } catch {}
    // URL params override sessionStorage (for direct links)
    if (searchParams.get('status')) saved.current.status = searchParams.get('status')!
    if (searchParams.get('q')) saved.current.q = searchParams.get('q')!
  }

  const [search, setSearch] = useState(saved.current.q || '')
  const [debouncedSearch, setDebouncedSearch] = useState(saved.current.q || '')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [statusFilter, setStatusFilter] = useState<string[]>(saved.current.status?.split(',').filter(Boolean) || [])
  const [typeFilter, setTypeFilter] = useState(saved.current.type || '')
  const [locationFilter, setLocationFilter] = useState(saved.current.location || '')
  const [equipFilter, setEquipFilter] = useState(saved.current.equip || '')
  const [brandFilter, setBrandFilter] = useState(saved.current.brand || '')
  const [modelFilter, setModelFilter] = useState(saved.current.model || '')
  const [equipTypes, setEquipTypes] = useState<string[]>([])
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [osLocationLabel, setOsLocationLabel] = useState<Record<string, string>>({ LOJA: 'Loja', EXTERNO: 'Externo' })
  const [dateFrom, setDateFrom] = useState(saved.current.from || '')
  const [dateTo, setDateTo] = useState(saved.current.to || '')
  const [totalFiltered, setTotalFiltered] = useState(0)
  const [page, setPage] = useState(parseInt(saved.current.page || '1') || 1)
  const [totalPages, setTotalPages] = useState(1)
  const [view, setView] = useState<'table' | 'kanban'>((saved.current.view as 'table' | 'kanban') || 'table')
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set())
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [sortField, setSortField] = useState<string>('os_number')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [overdueFilter, setOverdueFilter] = useState(searchParams.get('overdue') === '1')
  // Persist filters to sessionStorage + URL (survives Next.js client navigation)
  useEffect(() => {
    const data: Record<string, string> = {}
    if (debouncedSearch) data.q = debouncedSearch
    if (statusFilter.length) data.status = statusFilter.join(',')
    if (typeFilter) data.type = typeFilter
    if (locationFilter) data.location = locationFilter
    if (equipFilter) data.equip = equipFilter
    if (brandFilter) data.brand = brandFilter
    if (modelFilter) data.model = modelFilter
    if (dateFrom) data.from = dateFrom
    if (dateTo) data.to = dateTo
    if (overdueFilter) data.overdue = '1'
    if (page > 1) data.page = String(page)
    if (view !== 'table') data.view = view

    // Save to sessionStorage (primary — always works with client-side nav)
    try { sessionStorage.setItem('os_filters', JSON.stringify(data)) } catch {}

    // Also update URL for shareable links + browser back
    const params = new URLSearchParams(data)
    const qs = params.toString()
    const newUrl = qs ? `${pathname}?${qs}` : pathname
    window.history.replaceState(null, '', newUrl)
  }, [debouncedSearch, statusFilter, typeFilter, locationFilter, equipFilter, brandFilter, modelFilter, dateFrom, dateTo, overdueFilter, page, view, pathname])

  const [showCancelled, setShowCancelled] = useState(false)
  const [showDelivered, setShowDelivered] = useState(false)
  const [allowedColumns, setAllowedColumns] = useState<string[]>([])
  const [ownOnly, setOwnOnly] = useState(false)
  const [myOsFilter, setMyOsFilter] = useState(false) // "Minhas OS" toggle, default set after auth loads
  const [visibilityLoaded, setVisibilityLoaded] = useState(false)
  const [hiddenByUser, setHiddenByUser] = useState<Set<string>>(new Set())
  const [showColToggle, setShowColToggle] = useState(false)
  const [showStatusFilter, setShowStatusFilter] = useState(false)
  const [actionMenuId, setActionMenuId] = useState<string | null>(null)
  const [showBulkStatus, setShowBulkStatus] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [nfseModalOS, setNfseModalOS] = useState<any>(null)
  const [nfseDesc, setNfseDesc] = useState('')
  const [emittingNfse, setEmittingNfse] = useState(false)
  const [bulkChanging, setBulkChanging] = useState(false)
  const [tecnicos, setTecnicos] = useState<{ id: string; name: string }[]>([])
  const [showBulkAssign, setShowBulkAssign] = useState(false)
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [showBulkNotify, setShowBulkNotify] = useState(false)
  const [bulkNotifying, setBulkNotifying] = useState(false)
  const [notifyChannels, setNotifyChannels] = useState({ email: true, whatsapp: true })
  const [showBulkPrintMenu, setShowBulkPrintMenu] = useState(false)

  // Técnico: pre-filter by "Aprovado" status + oldest first on first load
  const [defaultFilterApplied, setDefaultFilterApplied] = useState(false)
  useEffect(() => {
    if (isTecnico && !defaultFilterApplied && Object.keys(statusMap).length > 0) {
      const tecnicoStatuses = Object.entries(statusMap)
        .filter(([, v]) => v.name.toLowerCase().includes('aprovad') || v.name.toLowerCase().includes('aguardando pe'))
        .map(([id]) => id)
      if (tecnicoStatuses.length > 0) {
        setStatusFilter(tecnicoStatuses)
        setSortField('created_at')
        setSortDir('asc') // mais antigas primeiro
      }
      setDefaultFilterApplied(true)
    }
  }, [isTecnico, defaultFilterApplied, statusMap])

  // Debounce search: wait 300ms after user stops typing
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
      // Clear status filter when searching (so results aren't hidden by filter)
      if (search) setStatusFilter([])
    }, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [search])

  // Load technicians list
  useEffect(() => {
    fetch('/api/users?simple=true').then(r => r.json()).then(d => setTecnicos(d.data ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showBulkDelete) { setShowBulkDelete(false); return }
        if (nfseModalOS && !emittingNfse) { setNfseModalOS(null); return }
        if (showBulkStatus) { setShowBulkStatus(false); return }
        if (showExportMenu) { setShowExportMenu(false); return }
        if (showBulkAssign) { setShowBulkAssign(false); return }
        if (showBulkNotify) { setShowBulkNotify(false); return }
        if (showBulkPrintMenu) { setShowBulkPrintMenu(false); return }
        if (showColumnPicker) { setShowColumnPicker(false); return }
        if (showStatusFilter) { setShowStatusFilter(false); return }
        if (actionMenuId) { setActionMenuId(null); return }
      }
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [showBulkDelete, nfseModalOS, emittingNfse, showBulkStatus, showExportMenu, showBulkAssign, showBulkNotify, showBulkPrintMenu, showColumnPicker, showStatusFilter, actionMenuId])

  // Load role-based visibility config
  useEffect(() => {
    if (isAdmin) {
      setAllowedColumns(['os_number', 'created_at', 'customer', 'equipment_type', 'equipment_brand', 'equipment_model', 'os_type', 'os_location', 'status', 'total_cost', 'financeiro', 'technician', 'priority'])
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
        setAllowedColumns(['os_number', 'created_at', 'customer', 'equipment_type', 'equipment_brand', 'equipment_model', 'os_type', 'os_location', 'status', 'total_cost', 'financeiro', 'technician', 'priority'])
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
      .catch(() => toast.error('Erro ao carregar status do kanban'))
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

  const abortRef = useRef<AbortController | null>(null)

  function loadOS() {
    if (!visibilityLoaded) return
    // Cancel previous request to prevent stale data overwriting fresh results
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '100')
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (statusFilter.length === 1) params.set('statusId', statusFilter[0])
    else if (statusFilter.length > 1) statusFilter.forEach(s => params.append('statusId', s))
    if (typeFilter) params.set('osType', typeFilter)
    if (locationFilter) params.set('osLocation', locationFilter)
    if (equipFilter) params.set('equipmentType', equipFilter)
    if (brandFilter) params.set('equipmentBrand', brandFilter)
    if (modelFilter) params.set('equipmentModel', modelFilter)
    if (overdueFilter) params.set('overdue', 'true')
    if (!showCancelled) params.set('hideCancelled', 'true')
    if (!showDelivered) params.set('hideDelivered', 'true')
    if (ownOnly) params.set('own_only', 'true')
    // "Minhas OS" toggle: when active, explicitly send technicianId for any role
    if (myOsFilter && authUser) {
      params.set('technicianId', authUser.id)
    } else if (!myOsFilter && (isTecnico || isMotorista)) {
      // tecnico/motorista explicitly asked to see all
      params.set('showAll', 'true')
    }
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (sortField) params.set('sortBy', sortField)
    if (sortDir) params.set('sortDir', sortDir)
    fetch(`/api/os?${params}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => {
        const list = d.data ?? []
        setOsList(list)
        setTotalPages(d.totalPages ?? 1)
        setTotalFiltered(d.total ?? 0)
        // Extract unique brands/models for filter dropdowns
        const brands = [...new Set(list.map((o: OS) => o.equipment_brand).filter(Boolean))] as string[]
        const models = [...new Set(list.map((o: OS) => o.equipment_model).filter(Boolean))] as string[]
        setBrandOptions(prev => { const merged = [...new Set([...prev, ...brands])]; return merged.length !== prev.length ? merged.sort() : prev })
        setModelOptions(prev => { const merged = [...new Set([...prev, ...models])]; return merged.length !== prev.length ? merged.sort() : prev })
      })
      .catch(e => { if (e.name !== 'AbortError') toast.error('Erro ao carregar ordens de servico') })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
  }

  useEffect(() => { loadOS(); setSelected(new Set()) }, [debouncedSearch, statusFilter, typeFilter, locationFilter, equipFilter, brandFilter, modelFilter, overdueFilter, showCancelled, showDelivered, page, visibilityLoaded, ownOnly, myOsFilter, dateFrom, dateTo, sortField, sortDir])

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
      // Garantia sempre primeiro (topo da lista)
      const aW = a.is_warranty === true ? 0 : 1
      const bW = b.is_warranty === true ? 0 : 1
      if (aW !== bW) return aW - bW

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

  // Quick actions for single OS
  function printSingleOS(osId: string, template?: string) {
    setActionMenuId(null)
    const printWindow = window.open('', '_blank')
    if (!printWindow) { toast.error('Popup bloqueado — permita popups'); return }
    printWindow.document.write('<html><body><p>Carregando...</p></body></html>')

    const url = template ? `/api/os/${osId}/pdf?template=${template}` : `/api/os/${osId}/pdf`
    fetch(url)
      .then(r => r.text())
      .then(html => {
        printWindow.document.open()
        printWindow.document.write(html)
        printWindow.document.close()
        printWindow.onload = () => { printWindow.print() }
      })
      .catch(() => { printWindow.close(); toast.error('Erro ao carregar impressao') })
  }

  async function openNfseFromList(os: any) {
    setActionMenuId(null)
    // Buscar template
    let template = 'Reparo em {{equipamento}} marca {{marca}} modelo {{modelo}}, numero de serie {{serie}}, conforme ordem de servico numero {{os_number}}. Garantia {{garantia}} dias.'
    let garantiaDias = '90'
    try {
      const res = await fetch('/api/settings/nfse-template')
      if (res.ok) {
        const data = await res.json()
        if (data.template) template = data.template
        if (data.garantia_dias) garantiaDias = data.garantia_dias
      }
    } catch {}

    const desc = template
      .replace(/\{\{equipamento\}\}/g, os.equipment_type || 'Impressora')
      .replace(/\{\{marca\}\}/g, os.equipment_brand || '')
      .replace(/\{\{modelo\}\}/g, os.equipment_model || '')
      .replace(/\{\{serie\}\}/g, os.serial_number || 'N/A')
      .replace(/\{\{os_number\}\}/g, String(os.os_number))
      .replace(/\{\{garantia\}\}/g, garantiaDias)
      .replace(/\{\{cliente\}\}/g, os.customers?.legal_name || '')
      .replace(/\{\{itens\}\}/g, '')
      .replace(/\{\{valor\}\}/g, `R$ ${((os.total_cost || 0) / 100).toFixed(2)}`)
      .replace(/\s+/g, ' ').trim()

    setNfseDesc(desc)
    setNfseModalOS(os)
  }

  async function handleEmitirNfseFromList() {
    const os = nfseModalOS
    if (!os || emittingNfse) return
    if ((os.total_cost || 0) <= 0) { toast.error('OS sem valor'); return }
    if (!os.customers?.document_number) { toast.error('Cliente sem CPF/CNPJ'); return }

    setEmittingNfse(true)
    try {
      const res = await fetch('/api/fiscal/emitir-nfse-sp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: os.customer_id,
          service_order_id: os.id,
          description: nfseDesc,
          service_code: '07498',
          total_amount: os.total_cost,
          aliquota_iss: 0.05,
          iss_retido: false,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`NFS-e #${data.numero_nfse} emitida e enviada por email!`)
        setNfseModalOS(null)
        if (data.link_nfse) window.open(data.link_nfse, '_blank')
        loadOS()
      } else {
        toast.error(data.erros?.map((e: any) => `[${e.codigo}] ${e.mensagem}`).join('\n') || data.error || 'Erro')
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao emitir NFS-e')
    } finally {
      setEmittingNfse(false)
    }
  }

  async function bulkChangeStatus(targetStatusId: string) {
    setBulkChanging(true)
    try {
      const res = await fetch('/api/os/bulk-transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), toStatusId: targetStatusId }),
      })
      const data = await res.json()
      if (res.ok) {
        const ok = data.data?.ok ?? 0
        const fail = data.data?.fail ?? 0
        toast.success(`${ok} OS alterada(s)${fail ? `, ${fail} erro(s)` : ''}`)
        if (fail > 0) {
          const errors = (data.data?.results ?? []).filter((r: any) => !r.success)
          errors.forEach((r: any) => toast.error(`OS-${String(r.os_number).padStart(4, '0')}: ${r.error}`))
        }
      } else {
        toast.error(data.error || 'Erro ao alterar status')
      }
    } catch {
      toast.error('Erro ao alterar status em massa')
    }
    setShowBulkStatus(false); setBulkChanging(false); setSelected(new Set()); loadOS()
  }

  async function bulkAssignTechnician(technicianId: string) {
    setBulkAssigning(true)
    try {
      const res = await fetch('/api/os/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), technician_id: technicianId }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${data.data?.updated ?? 0} OS atribuída(s) para ${data.data?.technician ?? 'técnico'}`)
      } else {
        toast.error(data.error || 'Erro ao atribuir técnico')
      }
    } catch {
      toast.error('Erro ao atribuir técnico em massa')
    }
    setShowBulkAssign(false); setBulkAssigning(false); setSelected(new Set()); loadOS()
  }

  // Bulk print individual OS documents using templates
  function bulkPrintOS(template: string) {
    const ids = Array.from(selected)
    if (ids.length === 0) { toast.error('Selecione pelo menos uma OS'); return }
    setShowBulkPrintMenu(false)
    const url = `/api/os/bulk-print?ids=${ids.join(',')}&template=${template}`
    const w = window.open('', '_blank')
    if (!w) { toast.error('Popup bloqueado — permita popups'); return }
    w.document.write('<html><body><p>Carregando...</p></body></html>')
    fetch(url)
      .then(r => r.text())
      .then(html => { w.document.open(); w.document.write(html); w.document.close() })
      .catch(() => { w.close(); toast.error('Erro ao carregar impressao') })
  }

  // Bulk notify customers of selected OS
  async function bulkNotifyOS() {
    setBulkNotifying(true)
    try {
      const res = await fetch('/api/os/bulk-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), channels: notifyChannels }),
      })
      const data = await res.json()
      if (res.ok) {
        const d = data.data
        const parts = []
        if (d.emailOk > 0) parts.push(`${d.emailOk} email(s)`)
        if (d.whatsappOk > 0) parts.push(`${d.whatsappOk} WhatsApp`)
        if (d.errors > 0) parts.push(`${d.errors} erro(s)`)
        toast.success(`Notificações enviadas: ${parts.join(', ')}`)
      } else {
        toast.error(data.error || 'Erro ao notificar')
      }
    } catch {
      toast.error('Erro ao notificar em massa')
    }
    setShowBulkNotify(false); setBulkNotifying(false); setSelected(new Set())
  }

  // Quick filter: "Coletas do dia" — select status "Coletar" and today's date
  function filterColetasDoDia() {
    const coletarIds = Object.entries(statusMap)
      .filter(([, v]) => /coletar|coleta/i.test(v.name))
      .map(([id]) => id)
    if (coletarIds.length === 0) { toast.error('Status "Coletar" não encontrado'); return }
    setStatusFilter(coletarIds)
    setPage(1)
    toast.success('Filtro: Coletas do dia')
  }

  // Effective visible columns = allowed by role - hidden by user
  const effectiveColumns = allowedColumns.filter(c => !hiddenByUser.has(c))

  const allColumnLabels: Record<string, string> = {
    os_number: 'Nº', created_at: 'Data', customer: 'Cliente', equipment_type: 'Equip.',
    equipment_brand: 'Marca', equipment_model: 'Modelo',
    os_type: 'Tipo', os_location: 'Local', status: 'Status', total_cost: 'Valor', financeiro: 'Financeiro', technician: 'Técnico', priority: 'Prioridade',
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
        case 'equipment_brand': return os.equipment_brand || ''
        case 'equipment_model': return os.equipment_model || ''
        case 'os_type': return osTypeLabel[os.os_type] || os.os_type
        case 'os_location': return os.os_location || ''
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

  const exportColumns = [
    { key: 'os_number', label: 'Numero OS' },
    { key: 'created_at', label: 'Data', format: (v: string) => v ? new Date(v).toLocaleDateString('pt-BR') : '' },
    { key: 'customer_name', label: 'Cliente' },
    { key: 'equipment_type', label: 'Equipamento' },
    { key: 'equipment_brand', label: 'Marca' },
    { key: 'equipment_model', label: 'Modelo' },
    { key: 'os_type', label: 'Tipo' },
    { key: 'os_location', label: 'Local' },
    { key: 'status_name', label: 'Status' },
    { key: 'total_cost', label: 'Valor', format: (v: number) => v ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v / 100) : '' },
    { key: 'technician_name', label: 'Tecnico' },
  ]

  function handleExport(format: 'excel' | 'csv' | 'pdf') {
    const selectedOS = osList.filter(os => selected.has(os.id))
    const dataToExport = selectedOS.length > 0 ? selectedOS : osList
    if (dataToExport.length === 0) { toast.error('Nenhuma OS para exportar'); return }

    const mappedData = dataToExport.map(os => ({
      os_number: `OS-${String(os.os_number).padStart(4, '0')}`,
      created_at: os.created_at,
      customer_name: os.customers?.legal_name || '',
      equipment_type: os.equipment_type || '',
      equipment_brand: os.equipment_brand || '',
      equipment_model: os.equipment_model || '',
      os_type: osTypeLabel[os.os_type] || os.os_type,
      os_location: os.os_location || '',
      status_name: statusMap[os.status_id]?.name || '',
      total_cost: os.total_cost || 0,
      technician_name: os.user_profiles?.name || '',
    }))

    const filename = `ordens-servico-${new Date().toISOString().split('T')[0]}`
    const title = 'Ordens de Servico'
    const params = { filename, title, columns: exportColumns, data: mappedData }

    if (format === 'excel') exportToExcel(params)
    else if (format === 'csv') exportToCSV(params)
    else exportToPDF(params)

    toast.success(`${dataToExport.length} OS exportadas para ${format.toUpperCase()}`)
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
          case 'os_type': return osTypeLabel[os.os_type] || os.os_type
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
    <div className="space-y-3">
      {/* Row 1: Search + counter + Nova OS */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            placeholder="Buscar por numero, cliente, equipamento..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {!loading && (
          <span className="text-sm text-gray-500 font-medium whitespace-nowrap">
            Ordens de Servico ({totalFiltered})
          </span>
        )}
        {selected.size > 0 && (
          <>
            <select title="Imprimir selecionados" onChange={e => {
              if (!e.target.value) return
              bulkPrintOS(e.target.value)
              e.target.value = ''
            }}
              className="rounded-lg border bg-white px-3 py-2 text-sm text-gray-700 cursor-pointer">
              <option value="">Imprimir {selected.size}...</option>
              <option value="os_pickup">Coleta</option>
              <option value="os_delivery_repair">Entrega Reparado</option>
              <option value="os_delivery_norepair">Entrega sem Reparo</option>
              <option value="os_full">OS Completa</option>
            </select>
            {isAdmin && (
              <button type="button" onClick={() => setShowBulkDelete(true)}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 whitespace-nowrap">
                <Trash2 className="h-4 w-4" /> Excluir {selected.size}
              </button>
            )}
          </>
        )}
        {canCreateOs && (
          <Link
            href="/os/novo"
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" /> Nova OS
          </Link>
        )}
      </div>

      {/* Row 2: Compact filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Multi-status filter */}
        <div className="relative">
          <button type="button" onClick={() => setShowStatusFilter(!showStatusFilter)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium',
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
                    {statusFilter.includes(col.id) && <span className="ml-auto text-blue-500">&#10003;</span>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <select title="Filtrar por tipo" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
          className={cn('rounded-md border px-2 py-1.5 text-xs', typeFilter ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white text-gray-600')}>
          <option value="">Todos os Tipos</option>
          {Object.entries(osTypeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select title="Filtrar por local" value={locationFilter} onChange={e => { setLocationFilter(e.target.value); setPage(1) }}
          className={cn('rounded-md border px-2 py-1.5 text-xs', locationFilter ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white text-gray-600')}>
          <option value="">Todos os Locais</option>
          {Object.entries(osLocationLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select title="Filtrar por equipamento" value={equipFilter} onChange={e => { setEquipFilter(e.target.value); setPage(1) }}
          className={cn('rounded-md border px-2 py-1.5 text-xs', equipFilter ? 'bg-teal-50 border-teal-300 text-teal-700' : 'bg-white text-gray-600')}>
          <option value="">Todos Equipamentos</option>
          {equipTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select title="Filtrar por marca" value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setPage(1) }}
          className={cn('rounded-md border px-2 py-1.5 text-xs', brandFilter ? 'bg-teal-50 border-teal-300 text-teal-700' : 'bg-white text-gray-600')}>
          <option value="">Todas Marcas</option>
          {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select title="Filtrar por modelo" value={modelFilter} onChange={e => { setModelFilter(e.target.value); setPage(1) }}
          className={cn('rounded-md border px-2 py-1.5 text-xs', modelFilter ? 'bg-teal-50 border-teal-300 text-teal-700' : 'bg-white text-gray-600')}>
          <option value="">Todos Modelos</option>
          {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-gray-300">|</span>
        {/* Date filters */}
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
          title="Data de" placeholder="De" className="rounded-md border bg-white px-2 py-1.5 text-xs w-[120px]" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
          title="Data ate" placeholder="Ate" className="rounded-md border bg-white px-2 py-1.5 text-xs w-[120px]" />
        <span className="text-gray-300">|</span>
        <button type="button"
          onClick={() => { setOverdueFilter(!overdueFilter); setPage(1) }}
          title="Filtrar OS em atraso"
          className={cn(
            'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
            overdueFilter
              ? 'bg-red-100 border-red-400 text-red-700 ring-1 ring-red-300 shadow-sm'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          )}>
          <AlertTriangle className="h-3.5 w-3.5" />
          Em atraso
          {(() => {
            const count = osList.filter(o => {
              const st = o.module_statuses || statusMap[o.status_id]
              return isOverdue(o, st?.name)
            }).length
            return count > 0 ? (
              <span className="ml-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 leading-none min-w-[18px] text-center">
                {count}
              </span>
            ) : null
          })()}
        </button>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 hover:text-gray-700">
          <input type="checkbox" checked={showDelivered} onChange={e => { setShowDelivered(e.target.checked); setPage(1) }}
            className="rounded border-gray-300 h-3.5 w-3.5" />
          Entregues
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 hover:text-gray-700">
          <input type="checkbox" checked={showCancelled} onChange={e => { setShowCancelled(e.target.checked); setPage(1) }}
            className="rounded border-gray-300 h-3.5 w-3.5" />
          Canceladas
        </label>
        <span className="text-gray-300">|</span>
        <button type="button"
          onClick={() => { setMyOsFilter(!myOsFilter); setPage(1) }}
          title="Filtrar apenas OS atribuidas a mim"
          className={cn(
            'flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
            myOsFilter ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white text-gray-600 hover:bg-gray-50'
          )}>
          Minhas OS
        </button>
        <span className="text-gray-300">|</span>
        {/* Column toggle */}
        <div className="relative">
          <button type="button" onClick={() => setShowColToggle(!showColToggle)}
            title="Mostrar/esconder colunas"
            className="flex items-center gap-1 rounded-md border bg-white px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            <Columns3 className="h-3.5 w-3.5" /> Colunas
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
          <button type="button" onClick={() => setView('table')} title="Tabela" className={cn('p-1.5', view === 'table' && 'bg-gray-100')}>
            <List className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setView('kanban')} title="Kanban" className={cn('p-1.5', view === 'kanban' && 'bg-gray-100')}>
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
        <button type="button" onClick={filterColetasDoDia}
          title="Filtrar OS com status Coletar"
          className="flex items-center gap-1 rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-700 transition-colors">
          <Truck className="h-3.5 w-3.5" /> Coletas do dia
        </button>
        {(statusFilter.length > 0 || dateFrom || dateTo || overdueFilter || search || brandFilter || modelFilter || equipFilter || typeFilter || locationFilter) && (
          <button type="button" onClick={() => { setStatusFilter([]); setDateFrom(''); setDateTo(''); setOverdueFilter(false); setSearch(''); setBrandFilter(''); setModelFilter(''); setEquipFilter(''); setTypeFilter(''); setLocationFilter(''); setPage(1); try { sessionStorage.removeItem('os_filters') } catch {} }}
            className="text-xs text-blue-600 hover:underline ml-1">Limpar filtros</button>
        )}
      </div>

      {(ownOnly || myOsFilter) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Exibindo apenas suas OS atribuidas.{' '}
          {myOsFilter && (
            <button type="button" onClick={() => { setMyOsFilter(false); setPage(1) }}
              className="underline text-amber-800 hover:text-amber-900">Ver todas</button>
          )}
        </div>
      )}

      {view === 'table' ? (
        <>
          {/* Table view */}
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                  <th className="px-3 py-2.5 w-10">
                    <input type="checkbox" title="Selecionar todos"
                      checked={osList.length > 0 && selected.size === osList.length}
                      onChange={toggleAll} className="rounded text-blue-600" />
                  </th>
                  {[
                    { key: 'os_number', label: 'N\u00ba' },
                    { key: 'created_at', label: 'Data' },
                    { key: 'customer', label: 'Cliente' },
                    { key: 'equipment_type', label: 'Equip.' },
                    { key: 'equipment_brand', label: 'Marca' },
                    { key: 'equipment_model', label: 'Modelo' },
                    { key: 'os_type', label: 'Tipo' },
                    { key: 'os_location', label: 'Local' },
                    { key: 'status', label: 'Status' },
                    { key: 'total_cost', label: 'Valor' },
                    { key: 'financeiro', label: 'Financeiro' },
                    { key: 'technician', label: 'T\u00e9cnico' },
                    { key: 'priority', label: 'Prioridade' },
                  ].filter(col => effectiveColumns.includes(col.key)).map(col => (
                    <th key={col.key} className="px-3 py-2.5 text-nowrap">
                      <button type="button" onClick={() => handleSort(col.key)}
                        className="flex items-center gap-1 hover:text-gray-700 transition-colors"
                        title={`Ordenar por ${col.label}`}>
                        {col.label} <SortIcon field={col.key} />
                      </button>
                    </th>
                  ))}
                  <th className="px-2 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={effectiveColumns.length + (isAdmin ? 1 : 0)} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
                ) : osList.length === 0 ? (
                  <tr><td colSpan={effectiveColumns.length + 2} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <SearchX className="h-10 w-10 text-gray-300" />
                      <p className="text-sm font-medium text-gray-500">{overdueFilter ? 'Nenhuma OS em atraso' : 'Nenhuma OS encontrada'}</p>
                      <p className="text-xs text-gray-400">{search ? `Nenhum resultado para "${search}". Tente outro termo.` : 'Ajuste os filtros ou crie uma nova OS.'}</p>
                    </div>
                  </td></tr>
                ) : (
                  getSortedList().map((os, rowIndex) => {
                    const st = os.module_statuses || statusMap[os.status_id]
                    const osIsOverdue = isOverdue(os, st?.name)
                    const isWarranty = os.is_warranty === true
                    const dlColor = isWarranty ? 'red' as const : getDeadlineColor(os, st?.name)
                    const dlStyle = dlColor ? deadlineStyles[dlColor] : null
                    return (
                      <tr key={os.id} className={cn(
                        'hover:bg-gray-50',
                        selected.has(os.id) && 'bg-blue-50',
                        isWarranty ? 'border-l-4 border-l-red-600 bg-red-50/60' : dlStyle?.row,
                      )}>
                        <td className="px-3 py-2.5">
                          <input type="checkbox" title={`Selecionar OS-${String(os.os_number).padStart(4, '0')}`}
                            checked={selected.has(os.id)} onChange={() => toggleSelect(os.id)}
                            className="rounded text-blue-600" />
                        </td>
                        {effectiveColumns.includes('os_number') && (
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              {dlColor && (
                                <span
                                  className={cn('h-2.5 w-2.5 rounded-full shrink-0', dlStyle?.dot)}
                                  title={dlColor === 'red' ? 'Prazo estourado' : dlColor === 'yellow' ? 'Prazo vencendo (≤2 dias)' : 'Dentro do prazo'}
                                />
                              )}
                              <Link href={`/os/${os.id}`} className={cn('font-bold hover:underline font-mono text-base tracking-tight', isWarranty ? 'text-red-600' : 'text-blue-600')}>
                                {os.os_number}
                              </Link>
                              {isWarranty && (
                                <span className="rounded bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-bold border border-red-300">GARANTIA</span>
                              )}
                            </div>
                          </td>
                        )}
                        {effectiveColumns.includes('created_at') && (
                          <td className="px-3 py-2.5 text-gray-500 text-xs text-nowrap">
                            {new Date(os.created_at).toLocaleDateString('pt-BR')}
                          </td>
                        )}
                        {effectiveColumns.includes('customer') && (
                          <td className="px-3 py-2.5 text-gray-700 text-xs max-w-[200px] truncate">{os.customers?.legal_name ?? '\u2014'}</td>
                        )}
                        {effectiveColumns.includes('equipment_type') && (
                          <td className="px-3 py-2.5 text-gray-700 text-xs">{os.equipment_type ?? '\u2014'}</td>
                        )}
                        {effectiveColumns.includes('equipment_brand') && (
                          <td className="px-3 py-2.5 text-gray-700 text-xs">{os.equipment_brand ?? '\u2014'}</td>
                        )}
                        {effectiveColumns.includes('equipment_model') && (
                          <td className="px-3 py-2.5 text-gray-700 text-xs">{os.equipment_model ?? '\u2014'}</td>
                        )}
                        {effectiveColumns.includes('os_type') && (
                          <td className="px-3 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${osTypeColor[os.os_type] || 'bg-gray-100 text-gray-700'}`}>
                              {osTypeLabel[os.os_type] || os.os_type}
                            </span>
                          </td>
                        )}
                        {effectiveColumns.includes('os_location') && (
                          <td className="px-3 py-2.5 text-gray-600 text-xs">{os.os_location || '\u2014'}</td>
                        )}
                        {effectiveColumns.includes('status') && (
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="rounded-full px-2 py-0.5 text-xs font-medium text-nowrap"
                                style={st ? { backgroundColor: st.color + '20', color: st.color } : {}}
                              >
                                {st?.name ?? os.status_id}
                              </span>
                              {dlColor === 'red' && (
                                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-600 flex items-center gap-0.5 text-nowrap">
                                  <Clock className="h-2.5 w-2.5" /> Atrasado
                                </span>
                              )}
                              {dlColor === 'yellow' && (
                                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700 flex items-center gap-0.5 text-nowrap">
                                  <AlertTriangle className="h-2.5 w-2.5" /> Vencendo
                                </span>
                              )}
                            </div>
                          </td>
                        )}
                        {effectiveColumns.includes('total_cost') && (
                          <td className="px-3 py-2.5 text-right text-xs font-medium text-gray-900 text-nowrap">
                            {(os.total_cost || 0) > 0 ? fmt(os.total_cost || 0) : '\u2014'}
                          </td>
                        )}
                        {effectiveColumns.includes('financeiro') && (
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                            {(() => {
                              const fin = getFinanceStatus(os)
                              if (!fin) return <span className="text-xs text-gray-400">{'\u2014'}</span>
                              return (
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', fin.color)}>
                                  {fin.label}
                                </span>
                              )
                            })()}
                            {os.invoices?.length > 0 && (
                              <a href={os.invoices[0].danfe_url || '#'} target="_blank" rel="noopener noreferrer" title={`NFS-e #${os.invoices[0].invoice_number}`}
                                className="rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 text-[9px] font-bold hover:bg-purple-200">
                                NF
                              </a>
                            )}
                            </div>
                          </td>
                        )}
                        {effectiveColumns.includes('technician') && (
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{os.user_profiles?.name ?? '\u2014'}</td>
                        )}
                        {effectiveColumns.includes('priority') && (
                          <td className={cn('px-3 py-2.5 text-xs text-nowrap', priorityColor[os.priority])}>
                            {priorityLabel[os.priority] ?? os.priority}
                          </td>
                        )}
                        {/* Action dropdown */}
                        <td className="px-2 py-2.5 text-right">
                          <button type="button" id={`action-btn-${os.id}`} onClick={e => { e.stopPropagation(); setActionMenuId(actionMenuId === os.id ? null : os.id) }}
                            className="p-2 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {actionMenuId === os.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setActionMenuId(null)} />
                              <div className="fixed z-50 w-52 rounded-lg border bg-white shadow-xl py-1"
                                ref={el => {
                                  if (!el) return
                                  const btn = document.getElementById(`action-btn-${os.id}`)
                                  if (!btn) return
                                  const rect = btn.getBoundingClientRect()
                                  const spaceBelow = window.innerHeight - rect.bottom
                                  el.style.right = `${window.innerWidth - rect.right}px`
                                  if (spaceBelow > el.scrollHeight + 8) {
                                    el.style.top = `${rect.bottom + 4}px`
                                    el.style.bottom = 'auto'
                                  } else {
                                    el.style.bottom = `${window.innerHeight - rect.top + 4}px`
                                    el.style.top = 'auto'
                                  }
                                }}>
                                <Link href={`/os/${os.id}`} onClick={() => setActionMenuId(null)}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Eye className="h-4 w-4 text-gray-400" /> Abrir
                                </Link>
                                <Link href={`/os/${os.id}/editar`} onClick={() => setActionMenuId(null)}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Search className="h-4 w-4 text-gray-400" /> Editar
                                </Link>
                                <Link href={`/os/novo?clonar=${os.id}`} onClick={() => setActionMenuId(null)}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Copy className="h-4 w-4 text-gray-400" /> Clonar
                                </Link>
                                <div className="border-t my-1" />
                                <div className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase">Imprimir</div>
                                <button type="button" onClick={() => printSingleOS(os.id, 'os_full')}
                                  className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Printer className="h-3.5 w-3.5 text-gray-400" /> OS Completa
                                </button>
                                <button type="button" onClick={() => printSingleOS(os.id, 'os_pickup')}
                                  className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Printer className="h-3.5 w-3.5 text-gray-400" /> Ordem de Coleta
                                </button>
                                <button type="button" onClick={() => printSingleOS(os.id, 'os_delivery_repair')}
                                  className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Printer className="h-3.5 w-3.5 text-gray-400" /> Entrega Reparado
                                </button>
                                <button type="button" onClick={() => printSingleOS(os.id, 'os_delivery_norepair')}
                                  className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Printer className="h-3.5 w-3.5 text-gray-400" /> Entrega sem Reparo
                                </button>
                                <div className="border-t my-1" />
                                <button type="button" onClick={() => {
                                  const line = `OS-${String(os.os_number).padStart(4, '0')} | ${os.customers?.legal_name || ''} | ${st?.name || ''} | ${fmt(os.total_cost || 0)}`
                                  window.open(`mailto:?subject=${encodeURIComponent(`OS-${String(os.os_number).padStart(4, '0')}`)}&body=${encodeURIComponent(line)}`)
                                  setActionMenuId(null)
                                }}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Mail className="h-4 w-4 text-gray-400" /> Enviar Email
                                </button>
                                {os.invoices?.length > 0 ? (
                                  <a href={os.invoices[0].danfe_url || '#'} target="_blank" rel="noopener noreferrer"
                                    onClick={() => setActionMenuId(null)}
                                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-green-700 hover:bg-green-50 w-full">
                                    <Receipt className="h-4 w-4 text-green-500" /> NFS-e #{os.invoices[0].invoice_number}
                                  </a>
                                ) : (os.total_cost || 0) > 0 ? (
                                  <button type="button" onClick={() => openNfseFromList(os)}
                                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-purple-700 hover:bg-purple-50 w-full">
                                    <Receipt className="h-4 w-4 text-purple-400" /> Emitir NFS-e
                                  </button>
                                ) : null}
                                <div className="border-t my-1" />
                                <Link href={`/financeiro/contas-receber?search=${encodeURIComponent(os.customers?.legal_name || '')}`} onClick={() => setActionMenuId(null)}
                                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full">
                                  <Receipt className="h-4 w-4 text-gray-400" /> Financeiro
                                </Link>
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Selection bar (sticky bottom) */}
          {selected.size > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 sticky bottom-4 z-10 shadow-lg">
              <span className="text-sm text-blue-700 font-medium">
                {selected.size} selecionada{selected.size !== 1 ? 's' : ''}
                {(() => {
                  const totalValue = osList.filter(o => selected.has(o.id)).reduce((sum, o) => sum + (o.total_cost || 0), 0)
                  return totalValue > 0 ? ` \u2014 Total: ${fmt(totalValue)}` : ''
                })()}
              </span>
              <div className="flex gap-2">
                {/* Batch print OS documents (individual, with page breaks) */}
                <div className="relative">
                  <button type="button" onClick={() => setShowBulkPrintMenu(!showBulkPrintMenu)} title="Imprimir OS individuais"
                    className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-gray-600">
                    <Printer className="h-3.5 w-3.5" /> Imprimir <ChevronDown className="h-3 w-3" />
                  </button>
                  {showBulkPrintMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowBulkPrintMenu(false)} />
                      <div className="absolute left-0 bottom-full mb-1 z-20 w-52 rounded-lg border bg-white shadow-lg py-1">
                        <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Imprimir {selected.size} OS</div>
                        <button type="button" onClick={() => bulkPrintOS('os_full')}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full">
                          <Printer className="h-3.5 w-3.5 text-gray-400" /> OS Completa
                        </button>
                        <button type="button" onClick={() => bulkPrintOS('os_pickup')}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full">
                          <Printer className="h-3.5 w-3.5 text-gray-400" /> Ordem de Coleta
                        </button>
                        <button type="button" onClick={() => bulkPrintOS('os_delivery_repair')}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full">
                          <Printer className="h-3.5 w-3.5 text-gray-400" /> Entrega Reparado
                        </button>
                        <button type="button" onClick={() => bulkPrintOS('os_delivery_norepair')}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full">
                          <Printer className="h-3.5 w-3.5 text-gray-400" /> Entrega sem Reparo
                        </button>
                        <div className="border-t my-1" />
                        <button type="button" onClick={() => { printOS(); setShowBulkPrintMenu(false) }}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 w-full">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-gray-400" /> Tabela Resumo
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {/* Bulk notify */}
                <button type="button" onClick={() => setShowBulkNotify(true)} title="Notificar clientes das OS selecionadas"
                  className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-green-700 border-green-300 bg-green-50">
                  <Bell className="h-3.5 w-3.5" /> Notificar
                </button>
                <div className="relative">
                  <button type="button" onClick={() => setShowExportMenu(!showExportMenu)} title="Exportar"
                    className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-gray-600">
                    <Download className="h-3.5 w-3.5" /> Exportar <ChevronDown className="h-3 w-3" />
                  </button>
                  {showExportMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                      <div className="absolute right-0 bottom-full mb-1 z-20 w-48 rounded-lg border bg-white shadow-lg py-1">
                        <button type="button" onClick={() => { handleExport('excel'); setShowExportMenu(false) }}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" /> Excel (.xlsx)
                        </button>
                        <button type="button" onClick={() => { handleExport('csv'); setShowExportMenu(false) }}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600" /> CSV
                        </button>
                        <button type="button" onClick={() => { handleExport('pdf'); setShowExportMenu(false) }}
                          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full">
                          <FileSpreadsheet className="h-3.5 w-3.5 text-red-600" /> PDF
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button type="button" onClick={emailOS} title="Enviar por email"
                  className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-gray-600">
                  <Mail className="h-3.5 w-3.5" /> Email
                </button>
                <div className="relative">
                  <button type="button" onClick={() => setShowBulkStatus(!showBulkStatus)}
                    className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-gray-600">
                    <RefreshCw className="h-3.5 w-3.5" /> Alterar Status <ChevronDown className="h-3 w-3" />
                  </button>
                  {showBulkStatus && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowBulkStatus(false)} />
                      <div className="absolute right-0 bottom-full mb-1 z-20 w-52 rounded-lg border bg-white shadow-lg py-1 max-h-64 overflow-y-auto">
                        <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Alterar {selected.size} OS para:</div>
                        {kanbanColumns.map(col => (
                          <button key={col.id} type="button" onClick={() => bulkChangeStatus(col.id)}
                            disabled={bulkChanging}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full disabled:opacity-50">
                            <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                            {col.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="relative">
                  <button type="button" onClick={() => setShowBulkAssign(!showBulkAssign)}
                    className="flex items-center gap-1.5 px-3 py-1 text-sm border rounded-md hover:bg-white text-gray-600">
                    <UserPlus className="h-3.5 w-3.5" /> Atribuir Tecnico <ChevronDown className="h-3 w-3" />
                  </button>
                  {showBulkAssign && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowBulkAssign(false)} />
                      <div className="absolute right-0 bottom-full mb-1 z-20 w-56 rounded-lg border bg-white shadow-lg py-1 max-h-64 overflow-y-auto">
                        <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase">Atribuir {selected.size} OS para:</div>
                        {tecnicos.map(t => (
                          <button key={t.id} type="button" onClick={() => bulkAssignTechnician(t.id)}
                            disabled={bulkAssigning}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 w-full disabled:opacity-50">
                            <UserPlus className="h-3.5 w-3.5 text-gray-400" />
                            {t.name}
                          </button>
                        ))}
                        {tecnicos.length === 0 && (
                          <p className="px-3 py-2 text-xs text-gray-400">Nenhum tecnico cadastrado</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
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
                          <span className="ml-auto text-xs text-gray-400">{col.totalCount ?? col.items.length}</span>
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
                <span className="ml-auto text-xs text-gray-400">{col.totalCount ?? col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-gray-400">Nenhuma OS</p>
                ) : col.items.map(os => (
                  <Link
                    key={os.id}
                    href={`/os/${os.id}`}
                    className={cn(
                      'block rounded-lg border bg-white p-3 shadow-sm hover:shadow-md transition-shadow',
                      isOverdue(os, col.name) && 'border-l-4 border-l-red-500 bg-red-50/30'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {os.os_number}
                        {(os as any).is_warranty && <span className="ml-1 rounded bg-amber-100 text-amber-800 px-1 py-0.5 text-[9px] font-bold">GAR</span>}
                      </span>
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
                      {isOverdue(os, col.name) && (
                        <span className="text-[10px] font-medium text-red-600 flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" /> Atrasado
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

      {/* Bulk Notify Modal */}
      {showBulkNotify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !bulkNotifying && setShowBulkNotify(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <Bell className="h-5 w-5 text-green-600" />
              <h2 className="text-lg font-semibold">Notificar {selected.size} cliente(s)</h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Enviar notificação de status para os clientes das OS selecionadas.
              As mensagens seguem o template configurado para cada status.
            </p>
            <div className="space-y-3 mb-4">
              <div className="rounded-lg bg-gray-50 p-3 text-sm max-h-32 overflow-y-auto">
                {osList.filter(os => selected.has(os.id)).map(os => {
                  const st = statusMap[os.status_id]
                  return (
                    <div key={os.id} className="flex items-center justify-between py-0.5">
                      <span className="text-gray-700">OS-{String(os.os_number).padStart(4, '0')} — {os.customers?.legal_name || 'Sem cliente'}</span>
                      <span className="text-xs rounded-full px-2 py-0.5" style={st ? { backgroundColor: st.color + '20', color: st.color } : {}}>
                        {st?.name || ''}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={notifyChannels.email}
                    onChange={e => setNotifyChannels(prev => ({ ...prev, email: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600 h-4 w-4" />
                  <Mail className="h-4 w-4 text-blue-500" /> Email
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={notifyChannels.whatsapp}
                    onChange={e => setNotifyChannels(prev => ({ ...prev, whatsapp: e.target.checked }))}
                    className="rounded border-gray-300 text-green-600 h-4 w-4" />
                  <MessageSquare className="h-4 w-4 text-green-500" /> WhatsApp
                </label>
              </div>
              {!notifyChannels.email && !notifyChannels.whatsapp && (
                <p className="text-xs text-red-500">Selecione pelo menos um canal de notificação.</p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowBulkNotify(false)} disabled={bulkNotifying}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={bulkNotifyOS}
                disabled={bulkNotifying || (!notifyChannels.email && !notifyChannels.whatsapp)}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 font-medium">
                {bulkNotifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {bulkNotifying ? 'Enviando...' : `Notificar ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NFS-e Quick Modal */}
      {nfseModalOS && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !emittingNfse && setNfseModalOS(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5 text-purple-600" />
                Emitir NFS-e - OS-{String(nfseModalOS.os_number).padStart(4, '0')}
              </h2>
              <button type="button" title="Fechar" onClick={() => setNfseModalOS(null)} disabled={emittingNfse} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <SearchX className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Cliente:</span><span className="font-medium">{nfseModalOS.customers?.legal_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">CPF/CNPJ:</span><span className="font-medium">{nfseModalOS.customers?.document_number ? formatDocument(nfseModalOS.customers.document_number) : 'Nao informado'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Equipamento:</span><span className="font-medium">{nfseModalOS.equipment_type || '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Valor:</span><span className="font-bold text-green-700">{fmt(nfseModalOS.total_cost || 0)}</span></div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Discriminacao do Servico</label>
                <textarea value={nfseDesc} onChange={e => setNfseDesc(e.target.value)} rows={4}
                  placeholder="Descricao do servico prestado..."
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button type="button" onClick={handleEmitirNfseFromList} disabled={emittingNfse || !nfseDesc || (nfseModalOS.total_cost || 0) <= 0}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50">
                {emittingNfse ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                {emittingNfse ? 'Emitindo...' : 'Emitir NFS-e'}
              </button>
              <button type="button" onClick={() => setNfseModalOS(null)} disabled={emittingNfse}
                className="px-4 py-2.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
