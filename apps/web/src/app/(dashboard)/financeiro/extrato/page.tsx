'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Search, Download, Loader2, TrendingUp, TrendingDown,
  DollarSign, Wallet, Filter, X, ChevronUp, ChevronDown, ArrowUpDown,
  Calendar, Building2, CreditCard, Tag, LayoutGrid, Pencil, Save, ExternalLink
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────
interface ExtratoItem {
  id: string; data: string; descricao: string; entidade: string
  conta_bancaria: string; centro_custo: string; categoria: string
  forma_pagamento: string; valor: number; tipo: 'ENTRADA' | 'SAIDA'
  origem: string; reconciliado?: boolean
}

interface Resumo {
  saldo_anterior: number; entradas: number; saidas: number
  saldo_periodo: number; saldo_atual: number
}

interface Conta { id: string; name: string; bank_name: string | null; current_balance: number }
interface Categoria { id: string; name: string; module: string }
interface CentroCusto { id: string; name: string }

// ─── Helpers ─────────────────────────────────────────────
function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function safeDate(v: string) {
  if (!v) return '--'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '--' : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10) }

// ─── Date Presets ────────────────────────────────────────
function getDatePreset(key: string): [string, string] {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth(), day = now.getDate()
  switch (key) {
    case 'hoje': return [isoDate(now), isoDate(now)]
    case '7d': { const d = new Date(y, m, day - 6); return [isoDate(d), isoDate(now)] }
    case '15d': { const d = new Date(y, m, day - 14); return [isoDate(d), isoDate(now)] }
    case 'mes': return [isoDate(new Date(y, m, 1)), isoDate(now)]
    case 'mes_ant': return [isoDate(new Date(y, m - 1, 1)), isoDate(new Date(y, m, 0))]
    case 'trim': return [isoDate(new Date(y, m - 2, 1)), isoDate(now)]
    case 'ano': return [isoDate(new Date(y, 0, 1)), isoDate(now)]
    default: return [isoDate(new Date(y, m, 1)), isoDate(now)]
  }
}

const DATE_PRESETS = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '15d', label: '15 dias' },
  { key: 'mes', label: 'Este Mes' },
  { key: 'mes_ant', label: 'Mes Anterior' },
  { key: 'trim', label: 'Trimestre' },
  { key: 'ano', label: 'Ano' },
]

type SortField = 'data' | 'descricao' | 'entidade' | 'categoria' | 'forma_pagamento' | 'valor'
type SortDir = 'asc' | 'desc'

// ─── Component ───────────────────────────────────────────
export default function ExtratoPage() {
  const router = useRouter()
  const now = new Date()
  const [items, setItems] = useState<ExtratoItem[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [contas, setContas] = useState<Conta[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [centrosCusto, setCentrosCusto] = useState<CentroCusto[]>([])
  const [formasPagamento, setFormasPagamento] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // Filtros
  const [fromDate, setFromDate] = useState(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [toDate, setToDate] = useState(isoDate(now))
  const [activePreset, setActivePreset] = useState('mes')
  const [accountId, setAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [tipoFilter, setTipoFilter] = useState<'' | 'ENTRADA' | 'SAIDA'>('')
  const [origem, setOrigem] = useState('')
  const [valueMin, setValueMin] = useState('')
  const [valueMax, setValueMax] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Sort
  const [sortField, setSortField] = useState<SortField>('data')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Quick edit modal
  const [editItem, setEditItem] = useState<ExtratoItem | null>(null)
  const [editForm, setEditForm] = useState({ category_id: '', payment_method: '', cost_center_id: '', valor: '', vencimento: '', notes: '' })
  const [editSaving, setEditSaving] = useState(false)

  // Debounce busca por texto (400ms)
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1) }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const loadData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (accountId) params.set('account_id', accountId)
    if (categoryId) params.set('category_id', categoryId)
    if (costCenterId) params.set('cost_center_id', costCenterId)
    if (paymentMethod) params.set('payment_method', paymentMethod)
    if (search) params.set('search', search)
    if (tipoFilter) params.set('tipo', tipoFilter)
    if (origem) params.set('origem', origem)
    if (valueMin) params.set('value_min', valueMin)
    if (valueMax) params.set('value_max', valueMax)
    params.set('page', String(page))
    params.set('limit', '50')

    fetch(`/api/financeiro/extrato?${params}`)
      .then(r => r.json())
      .then(d => {
        setItems(d.data?.items ?? [])
        setResumo(d.data?.resumo ?? null)
        setContas(d.data?.contas ?? [])
        setCategorias(d.data?.categorias ?? [])
        setCentrosCusto(d.data?.centros_custo ?? [])
        setFormasPagamento(d.data?.formas_pagamento ?? [])
        setTotal(d.data?.total ?? 0)
        setTotalPages(d.data?.totalPages ?? 1)
      })
      .catch(() => toast.error('Erro ao carregar extrato'))
      .finally(() => setLoading(false))
  }, [fromDate, toDate, accountId, categoryId, costCenterId, paymentMethod, search, tipoFilter, origem, valueMin, valueMax, page])

  useEffect(() => { loadData() }, [loadData])

  function applyPreset(key: string) {
    const [f, t] = getDatePreset(key)
    setFromDate(f); setToDate(t); setActivePreset(key); setPage(1)
  }

  function clearFilters() {
    setAccountId(''); setCategoryId(''); setCostCenterId(''); setPaymentMethod('')
    setSearch(''); setSearchInput(''); setTipoFilter(''); setOrigem(''); setValueMin(''); setValueMax('')
    applyPreset('mes')
  }

  // Sort client-side (items already paginated)
  const sortedItems = useMemo(() => {
    const sorted = [...items]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'data': cmp = a.data.localeCompare(b.data); break
        case 'descricao': cmp = a.descricao.localeCompare(b.descricao); break
        case 'entidade': cmp = a.entidade.localeCompare(b.entidade); break
        case 'categoria': cmp = a.categoria.localeCompare(b.categoria); break
        case 'forma_pagamento': cmp = a.forma_pagamento.localeCompare(b.forma_pagamento); break
        case 'valor': cmp = a.valor - b.valor; break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [items, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field); setSortDir(field === 'valor' ? 'desc' : 'asc')
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 text-gray-300" />
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 text-blue-600" /> : <ChevronDown className="h-3 w-3 text-blue-600" />
  }

  function exportCSV() {
    // Busca TODOS os registros (sem paginação) para exportar completo
    const params = new URLSearchParams()
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (accountId) params.set('account_id', accountId)
    if (categoryId) params.set('category_id', categoryId)
    if (costCenterId) params.set('cost_center_id', costCenterId)
    if (paymentMethod) params.set('payment_method', paymentMethod)
    if (search) params.set('search', search)
    if (tipoFilter) params.set('tipo', tipoFilter)
    if (origem) params.set('origem', origem)
    if (valueMin) params.set('value_min', valueMin)
    if (valueMax) params.set('value_max', valueMax)
    params.set('page', '1')
    params.set('limit', '10000')

    toast.info('Gerando CSV...')
    fetch(`/api/financeiro/extrato?${params}`)
      .then(r => r.json())
      .then(d => {
        const allItems: ExtratoItem[] = d.data?.items ?? []
        const header = 'Data;Lancamento;Entidade;Conta Bancaria;Centro Custo;Categoria;Forma Pagamento;Valor;Tipo\n'
        const rows = allItems.map(i =>
          `${safeDate(i.data)};${i.descricao};${i.entidade};${i.conta_bancaria};${i.centro_custo};${i.categoria};${i.forma_pagamento};${(i.valor / 100).toFixed(2).replace('.', ',')};${i.tipo}`
        ).join('\n')
        const bom = '\uFEFF'
        const blob = new Blob([bom + header + rows], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `extrato_${fromDate}_${toDate}.csv`; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        toast.success(`${allItems.length} registros exportados`)
      })
      .catch(() => toast.error('Erro ao exportar CSV'))
  }

  // Quick edit: open modal and load full record from API
  async function openQuickEdit(item: ExtratoItem) {
    if (item.origem !== 'receber' && item.origem !== 'pagar') return
    setEditItem(item)
    try {
      const endpoint = item.origem === 'receber' ? `/api/financeiro/contas-receber/${item.id}` : `/api/financeiro/contas-pagar/${item.id}`
      const res = await fetch(endpoint)
      const d = await res.json()
      const c = d.data
      if (c) {
        setEditForm({
          category_id: c.category_id || '',
          payment_method: c.payment_method || '',
          cost_center_id: c.cost_center_id || '',
          valor: String((c.total_amount || 0) / 100),
          vencimento: c.due_date ? new Date(c.due_date).toISOString().split('T')[0] : '',
          notes: c.notes || '',
        })
      }
    } catch { toast.error('Erro ao carregar dados') }
  }

  async function saveQuickEdit() {
    if (!editItem) return
    setEditSaving(true)
    try {
      const endpoint = editItem.origem === 'receber' ? `/api/financeiro/contas-receber/${editItem.id}` : `/api/financeiro/contas-pagar/${editItem.id}`
      const payload: any = {
        payment_method: editForm.payment_method || null,
        category_id: editForm.category_id || null,
        notes: editForm.notes || null,
      }
      if (editItem.origem === 'pagar') payload.cost_center_id = editForm.cost_center_id || null
      const amt = Math.round(parseFloat(editForm.valor) * 100)
      if (!isNaN(amt) && amt > 0) payload.total_amount = amt
      if (editForm.vencimento) payload.due_date = editForm.vencimento

      const res = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Lancamento atualizado!')
      setEditItem(null)
      loadData()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro ao salvar') }
    finally { setEditSaving(false) }
  }

  // Active filter chips
  const activeFilters: { key: string; label: string; onRemove: () => void }[] = []
  if (accountId) {
    const acc = contas.find(c => c.id === accountId)
    activeFilters.push({ key: 'account', label: `Banco: ${acc?.bank_name || acc?.name || '...'}`, onRemove: () => { setAccountId(''); setPage(1) } })
  }
  if (categoryId) {
    const cat = categorias.find(c => c.id === categoryId)
    activeFilters.push({ key: 'category', label: `Categoria: ${cat?.name || '...'}`, onRemove: () => { setCategoryId(''); setPage(1) } })
  }
  if (costCenterId) {
    const cc = centrosCusto.find(c => c.id === costCenterId)
    activeFilters.push({ key: 'costcenter', label: `C.Custo: ${cc?.name || '...'}`, onRemove: () => { setCostCenterId(''); setPage(1) } })
  }
  if (paymentMethod) {
    activeFilters.push({ key: 'payment', label: `Pagamento: ${paymentMethod}`, onRemove: () => { setPaymentMethod(''); setPage(1) } })
  }
  if (origem) {
    const origemLabels: Record<string, string> = { receber: 'A Receber', pagar: 'A Pagar', transacao: 'Transacao' }
    activeFilters.push({ key: 'origem', label: `Origem: ${origemLabels[origem] || origem}`, onRemove: () => { setOrigem(''); setPage(1) } })
  }
  if (valueMin || valueMax) {
    const label = valueMin && valueMax ? `Valor: R$${valueMin} ~ R$${valueMax}` : valueMin ? `Valor >= R$${valueMin}` : `Valor <= R$${valueMax}`
    activeFilters.push({ key: 'value', label, onRemove: () => { setValueMin(''); setValueMax(''); setPage(1) } })
  }
  if (search) {
    activeFilters.push({ key: 'search', label: `Busca: "${search}"`, onRemove: () => { setSearch(''); setSearchInput(''); setPage(1) } })
  }

  const hasFilters = activeFilters.length > 0 || tipoFilter !== ''

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro" className="rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Extrato Financeiro</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Lancamentos consolidados por periodo</p>
          </div>
        </div>
        <button type="button" onClick={exportCSV} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <Download className="h-4 w-4" /> Exportar CSV
        </button>
      </div>

      {/* Resumo Cards */}
      {resumo && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm text-center">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Saldo Anterior</p>
            <p className="text-lg font-bold text-blue-700 dark:text-blue-400 mt-1">{fmt(resumo.saldo_anterior)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm text-center">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-green-500" /> Entradas</p>
            <p className="text-lg font-bold text-green-600 dark:text-green-400 mt-1">{fmt(resumo.entradas)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm text-center">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-center gap-1"><TrendingDown className="h-3.5 w-3.5 text-red-500" /> Saidas</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400 mt-1">{fmt(resumo.saidas)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm text-center">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Saldo Periodo</p>
            <p className={cn('text-lg font-bold mt-1', resumo.saldo_periodo >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>{fmt(resumo.saldo_periodo)}</p>
          </div>
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 p-4 shadow-sm text-center">
            <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-center gap-1"><Wallet className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" /> Saldo Atual</p>
            <p className="text-lg font-bold text-blue-700 dark:text-blue-400 mt-1">{fmt(resumo.saldo_atual)}</p>
          </div>
        </div>
      )}

      {/* Tipo Tabs + Date Presets */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm space-y-3">
        {/* Row 1: Tipo tabs */}
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            {[
              { value: '' as const, label: 'Todos' },
              { value: 'ENTRADA' as const, label: 'Entradas', color: 'text-green-700 dark:text-green-400' },
              { value: 'SAIDA' as const, label: 'Saidas', color: 'text-red-700 dark:text-red-400' },
            ].map(tab => (
              <button key={tab.value} type="button"
                onClick={() => { setTipoFilter(tab.value); setPage(1) }}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                  tipoFilter === tab.value
                    ? 'bg-white dark:bg-gray-700 shadow-sm ' + (tab.color || 'text-gray-900 dark:text-white')
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                )}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-gray-200 dark:bg-gray-700" />
          {/* Date presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Calendar className="h-4 w-4 text-gray-400" />
            {DATE_PRESETS.map(p => (
              <button key={p.key} type="button"
                onClick={() => applyPreset(p.key)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                  activePreset === p.key
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700'
                )}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Date range + Search + Filter toggle */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">De</label>
            <input type="date" title="Data inicial" value={fromDate} onChange={e => { setFromDate(e.target.value); setActivePreset(''); setPage(1) }}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Ate</label>
            <input type="date" title="Data final" value={toDate} onChange={e => { setToDate(e.target.value); setActivePreset(''); setPage(1) }}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
          </div>
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Buscar por descricao, cliente, fornecedor..."
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
          </div>
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
            className={cn('flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all',
              showAdvanced ? 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800')}>
            <Filter className="h-4 w-4" /> Filtros
            {activeFilters.length > 0 && <span className="bg-blue-600 text-white rounded-full h-5 w-5 text-[10px] flex items-center justify-center font-bold">{activeFilters.length}</span>}
          </button>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <X className="h-3.5 w-3.5" /> Limpar tudo
            </button>
          )}
        </div>

        {/* Advanced Filters Panel */}
        {showAdvanced && (
          <div className="mt-1 pt-3 border-t border-gray-100 dark:border-gray-800 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div>
              <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
                <Wallet className="h-3 w-3" /> Banco / Conta
              </label>
              <select title="Banco / Conta" value={accountId} onChange={e => { setAccountId(e.target.value); setPage(1) }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white">
                <option value="">Todas</option>
                {contas.map(c => <option key={c.id} value={c.id}>{c.bank_name || c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
                <Tag className="h-3 w-3" /> Categoria
              </label>
              <select title="Categoria" value={categoryId} onChange={e => { setCategoryId(e.target.value); setPage(1) }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white">
                <option value="">Todas</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
                <Building2 className="h-3 w-3" /> Centro Custo
              </label>
              <select title="Centro de Custo" value={costCenterId} onChange={e => { setCostCenterId(e.target.value); setPage(1) }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white">
                <option value="">Todos</option>
                {centrosCusto.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
                <CreditCard className="h-3 w-3" /> Forma Pagamento
              </label>
              <select title="Forma de Pagamento" value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setPage(1) }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white">
                <option value="">Todas</option>
                {formasPagamento.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">
                <LayoutGrid className="h-3 w-3" /> Origem
              </label>
              <select title="Origem" value={origem} onChange={e => { setOrigem(e.target.value); setPage(1) }}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white">
                <option value="">Todas</option>
                <option value="receber">Contas a Receber</option>
                <option value="pagar">Contas a Pagar</option>
                <option value="transacao">Transacoes Bancarias</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Valor Min (R$)</label>
              <input type="number" step="0.01" min="0" value={valueMin} onChange={e => { setValueMin(e.target.value); setPage(1) }}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Valor Max (R$)</label>
              <input type="number" step="0.01" min="0" value={valueMax} onChange={e => { setValueMax(e.target.value); setPage(1) }}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400" />
            </div>
          </div>
        )}

        {/* Active Filter Chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {activeFilters.map(f => (
              <span key={f.key} className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                {f.label}
                <button type="button" title={`Remover filtro ${f.label}`} onClick={f.onRemove} className="hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5 transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Contas Bancarias - Quick Filter */}
      {contas.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm">
          <h3 className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">Contas Bancarias</h3>
          <div className="flex flex-wrap gap-3">
            {contas.map(c => (
              <button key={c.id} type="button" onClick={() => { setAccountId(accountId === c.id ? '' : c.id); setPage(1) }}
                className={cn(
                  'flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all',
                  accountId === c.id ? 'border-blue-500 dark:border-blue-600 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 shadow-sm ring-1 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm'
                )}>
                <div className={cn('h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white', accountId === c.id ? 'bg-blue-600' : 'bg-gray-400 dark:bg-gray-600')}>
                  {(c.bank_name || c.name).substring(0, 2).toUpperCase()}
                </div>
                <div className="text-left">
                  <p className="font-medium text-xs">{c.bank_name || c.name}</p>
                  <p className="font-bold text-sm">{fmt(c.current_balance ?? 0)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 transition-colors" onClick={() => toggleSort('data')}>
                <span className="flex items-center gap-1">Data <SortIcon field="data" /></span>
              </th>
              <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 transition-colors" onClick={() => toggleSort('descricao')}>
                <span className="flex items-center gap-1">Lancamento <SortIcon field="descricao" /></span>
              </th>
              <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 transition-colors" onClick={() => toggleSort('entidade')}>
                <span className="flex items-center gap-1">Entidade <SortIcon field="entidade" /></span>
              </th>
              <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 transition-colors" onClick={() => toggleSort('categoria')}>
                <span className="flex items-center gap-1">Categoria <SortIcon field="categoria" /></span>
              </th>
              <th className="px-4 py-3 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 transition-colors" onClick={() => toggleSort('forma_pagamento')}>
                <span className="flex items-center gap-1">Forma Pgto <SortIcon field="forma_pagamento" /></span>
              </th>
              <th className="px-4 py-3 text-right cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 transition-colors" onClick={() => toggleSort('valor')}>
                <span className="flex items-center justify-end gap-1">Valor <SortIcon field="valor" /></span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400 dark:text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Carregando...
              </td></tr>
            ) : sortedItems.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400 dark:text-gray-500">
                Nenhum lancamento encontrado no periodo
              </td></tr>
            ) : sortedItems.map(item => (
              <tr key={`${item.origem}-${item.id}`}
                onClick={() => openQuickEdit(item)}
                className={cn(
                  'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors',
                  (item.origem === 'receber' || item.origem === 'pagar') && 'cursor-pointer'
                )}>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap text-xs">{safeDate(item.data)}</td>
                <td className="px-4 py-3">
                  <p className={cn(
                    'font-medium text-sm',
                    (item.origem === 'receber' || item.origem === 'pagar')
                      ? 'text-blue-700 dark:text-blue-400 hover:underline'
                      : 'text-gray-900 dark:text-white'
                  )}>{item.descricao}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.conta_bancaria !== '—' && <span className="text-[10px] text-gray-400 dark:text-gray-500">{item.conta_bancaria}</span>}
                    {item.centro_custo !== '—' && <span className="text-[10px] text-gray-400 dark:text-gray-500">C.C: {item.centro_custo}</span>}
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium',
                      item.origem === 'receber' ? 'bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400' :
                      item.origem === 'pagar' ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400' :
                      'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                    )}>
                      {item.origem === 'receber' ? 'Receber' : item.origem === 'pagar' ? 'Pagar' : 'Banco'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">{item.entidade !== '—' ? item.entidade : <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                <td className="px-4 py-3">
                  {item.categoria !== '—' ? (
                    <span className="inline-flex items-center rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">{item.categoria}</span>
                  ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
                <td className="px-4 py-3">
                  {item.forma_pagamento !== '—' ? (
                    <span className="inline-flex items-center rounded-md bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">{item.forma_pagamento}</span>
                  ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
                <td className={cn('px-4 py-3 text-right font-semibold whitespace-nowrap', item.tipo === 'ENTRADA' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                  {item.tipo === 'ENTRADA' ? '+ ' : '- '}{fmt(item.valor)}
                </td>
              </tr>
            ))}
          </tbody>
          {/* Totais */}
          {!loading && sortedItems.length > 0 && resumo && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 font-semibold">
                <td colSpan={5} className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 text-sm">{total} lancamento(s)</td>
                <td className="px-4 py-3 text-right text-sm">
                  <span className="text-green-600 dark:text-green-400">+{fmt(resumo.entradas)}</span>
                  <span className="mx-1.5 text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-red-600 dark:text-red-400">-{fmt(resumo.saidas)}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Paginacao */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">Pagina {page} de {totalPages} ({total} registros)</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage(1)} disabled={page <= 1}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors">Primeira</button>
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors">Anterior</button>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors">Proxima</button>
            <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors">Ultima</button>
          </div>
        </div>
      )}

      {/* ═══ Quick Edit Modal ═══════════════════ */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditItem(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Pencil className="h-5 w-5 text-blue-600" /> Editar Lancamento
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{editItem.descricao}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('text-xs px-2 py-0.5 rounded font-medium',
                  editItem.origem === 'receber' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                )}>
                  {editItem.origem === 'receber' ? 'A Receber' : 'A Pagar'}
                </span>
                <a href={editItem.origem === 'receber' ? `/financeiro/contas-receber/${editItem.id}` : `/financeiro/contas-pagar/${editItem.id}`}
                  target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-600 transition-colors" title="Abrir detalhe completo">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Valor (R$)</label>
                  <input type="number" title="Valor" step="0.01" min="0" value={editForm.valor}
                    onChange={e => setEditForm(f => ({ ...f, valor: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Vencimento</label>
                  <input type="date" title="Vencimento" value={editForm.vencimento}
                    onChange={e => setEditForm(f => ({ ...f, vencimento: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Categoria</label>
                  <select title="Categoria" value={editForm.category_id}
                    onChange={e => setEditForm(f => ({ ...f, category_id: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white">
                    <option value="">Sem categoria</option>
                    {categorias.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Forma Pagamento</label>
                  <select title="Forma de pagamento" value={editForm.payment_method}
                    onChange={e => setEditForm(f => ({ ...f, payment_method: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white">
                    <option value="">—</option>
                    {formasPagamento.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              {editItem.origem === 'pagar' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Centro de Custo</label>
                  <select title="Centro de custo" value={editForm.cost_center_id}
                    onChange={e => setEditForm(f => ({ ...f, cost_center_id: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white">
                    <option value="">Sem centro de custo</option>
                    {centrosCusto.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider">Observacoes</label>
                <textarea rows={2} value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Observacoes..."
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none" />
              </div>
            </div>

            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setEditItem(null)}
                className="px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300">Cancelar</button>
              <button type="button" onClick={saveQuickEdit} disabled={editSaving}
                className="px-4 py-2.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium">
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
