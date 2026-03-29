'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus, Search, Eye, Pencil, Trash2, DollarSign,
  AlertTriangle, Clock, CheckCircle2, CalendarClock, X, Loader2, Zap,
  Filter, ChevronDown, ChevronUp
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/use-auth'

interface Customer {
  id: string
  legal_name: string
}

interface Category {
  id: string
  name: string
}

interface BankAccount {
  id: string
  name: string
  bank_name: string | null
}

interface ContaReceber {
  id: string
  description: string
  total_amount: number
  received_amount: number | null
  due_date: string
  status: string
  payment_method: string | null
  notes: string | null
  installment_count: number | null
  anticipated_at: string | null
  anticipation_fee: number | null
  anticipated_amount: number | null
  customers: Customer | null
  categories: Category | null
}

interface AnticipationInstallment {
  number: number
  amount: number
  due_date: string
  days_remaining: number
  fee: number
  net_amount: number
}

interface AnticipationPreview {
  installments: AnticipationInstallment[]
  total_amount: number
  total_fee: number
  anticipated_amount: number
  fee_pct_per_day: number
}

interface Summary {
  total_aberto: number
  total_aberto_count: number
  total_vencidas: number
  total_vencidas_count: number
  vencendo_hoje: number
  vencendo_hoje_count: number
  recebidas_mes: number
  recebidas_mes_count: number
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDENTE: { label: 'Pendente', color: 'bg-blue-100 text-blue-800' },
  VENCIDO: { label: 'Vencido', color: 'bg-red-100 text-red-800' },
  RECEBIDO: { label: 'Recebido', color: 'bg-green-100 text-green-800' },
  CANCELADO: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500' },
}

export default function ContasReceberPage() {
  const router = useRouter()
  const { isAdmin } = useAuth()
  const [contas, setContas] = useState<ContaReceber[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [dateType, setDateType] = useState('vencimento')
  const [valueMin, setValueMin] = useState('')
  const [valueMax, setValueMax] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filteredSum, setFilteredSum] = useState(0)

  // Filter options (loaded from API)
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  // Modals
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [baixaId, setBaixaId] = useState<string | null>(null)
  const [baixaLoading, setBaixaLoading] = useState(false)
  const [baixaAmount, setBaixaAmount] = useState('')
  const [baixaDate, setBaixaDate] = useState(() => new Date().toISOString().split('T')[0])
  const [baixaAccountId, setBaixaAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [antecipId, setAntecipId] = useState<string | null>(null)
  const [antecipPreview, setAntecipPreview] = useState<AnticipationPreview | null>(null)
  const [antecipLoading, setAntecipLoading] = useState(false)
  const [antecipConfirming, setAntecipConfirming] = useState(false)

  const loadContas = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (paymentMethodFilter) params.set('paymentMethod', paymentMethodFilter)
    if (categoryFilter) params.set('categoryId', categoryFilter)
    if (dateType !== 'vencimento') params.set('dateType', dateType)
    if (valueMin) params.set('valueMin', String(Math.round(Number(valueMin) * 100)))
    if (valueMax) params.set('valueMax', String(Math.round(Number(valueMax) * 100)))

    fetch(`/api/financeiro/contas-receber?${params}`)
      .then(r => r.json())
      .then(d => {
        setContas(d.data ?? [])
        setTotalPages(d.totalPages ?? 1)
        setTotal(d.total ?? 0)
        setFilteredSum(d.filteredSum ?? 0)
        if (d.summary) setSummary(d.summary)
      })
      .catch(() => toast.error('Erro ao carregar contas'))
      .finally(() => setLoading(false))
  }, [page, search, statusFilter, startDate, endDate, paymentMethodFilter, categoryFilter, dateType, valueMin, valueMax])

  useEffect(() => { loadContas(); setSelected(new Set()) }, [loadContas])

  // Load bank accounts for baixa modal
  useEffect(() => {
    fetch('/api/financeiro/contas-bancarias?limit=50')
      .then(r => r.json())
      .then(d => setBankAccounts(d.data ?? []))
      .catch(() => {})
  }, [])

  // Load filter options (payment methods + categories)
  useEffect(() => {
    fetch('/api/financeiro/formas-pagamento?limit=50')
      .then(r => r.json())
      .then(d => setPaymentMethods(d.data ?? []))
      .catch(() => {})
    fetch('/api/financeiro/categorias?limit=50')
      .then(r => r.json())
      .then(d => setCategories(d.data ?? []))
      .catch(() => {})
  }, [])

  function getDisplayStatus(conta: ContaReceber): string {
    if (conta.status === 'PENDENTE' && new Date(conta.due_date) < new Date(new Date().toDateString())) {
      return 'VENCIDO'
    }
    return conta.status || 'PENDENTE'
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    if (selected.size === contas.length) setSelected(new Set())
    else setSelected(new Set(contas.map(c => c.id)))
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    let ok = 0, fail = 0
    for (const id of selected) {
      try {
        const res = await fetch(`/api/financeiro/contas-receber/${id}`, { method: 'DELETE' })
        if (res.ok) ok++; else fail++
      } catch { fail++ }
    }
    toast.success(`${ok} conta(s) excluída(s)${fail ? `, ${fail} erro(s)` : ''}`)
    setShowBulkDelete(false); setSelected(new Set()); setBulkDeleting(false); loadContas()
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao excluir')
      }
      toast.success('Conta excluida com sucesso')
      setDeleteId(null)
      loadContas()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
    } finally {
      setDeleting(false)
    }
  }

  function openBaixa(conta: ContaReceber) {
    setBaixaId(conta.id)
    const remaining = conta.total_amount - (conta.received_amount || 0)
    setBaixaAmount(String((remaining / 100).toFixed(2)))
    setBaixaDate(new Date().toISOString().split('T')[0])
    setBaixaAccountId('')
  }

  async function handleBaixa() {
    if (!baixaId) return
    if (!baixaAmount || Number(baixaAmount) <= 0) {
      toast.error('Valor deve ser maior que zero')
      return
    }
    setBaixaLoading(true)
    try {
      const amountInCents = Math.round(Number(baixaAmount) * 100)
      const res = await fetch(`/api/financeiro/contas-receber/${baixaId}/baixa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          received_amount: amountInCents,
          received_at: baixaDate,
          account_id: baixaAccountId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao registrar recebimento')
      toast.success('Recebimento registrado com sucesso')
      setBaixaId(null)
      loadContas()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao registrar recebimento')
    } finally {
      setBaixaLoading(false)
    }
  }

  function clearFilters() {
    setSearch('')
    setStatusFilter('')
    setStartDate('')
    setEndDate('')
    setPaymentMethodFilter('')
    setCategoryFilter('')
    setDateType('vencimento')
    setValueMin('')
    setValueMax('')
    setPage(1)
  }

  function canAnticipate(conta: ContaReceber): boolean {
    if (!isAdmin) return false
    const displayStatus = getDisplayStatus(conta)
    if (displayStatus !== 'PENDENTE' && displayStatus !== 'VENCIDO') return false
    if (!conta.payment_method) return false
    const pm = conta.payment_method.toLowerCase()
    if (!pm.includes('cartão') && !pm.includes('cartao') && !pm.includes('credito') && !pm.includes('crédito')) return false
    if (!conta.installment_count || conta.installment_count <= 1) return false
    return true
  }

  async function openAntecipar(contaId: string) {
    setAntecipId(contaId)
    setAntecipPreview(null)
    setAntecipLoading(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${contaId}/antecipar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro ao carregar preview')
      setAntecipPreview(d.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar preview')
      setAntecipId(null)
    } finally {
      setAntecipLoading(false)
    }
  }

  async function handleAntecipar() {
    if (!antecipId) return
    setAntecipConfirming(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${antecipId}/antecipar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro ao antecipar')
      toast.success('Antecipacao realizada com sucesso!')
      setAntecipId(null)
      setAntecipPreview(null)
      loadContas()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao antecipar')
    } finally {
      setAntecipConfirming(false)
    }
  }

  const hasFilters = search || statusFilter || startDate || endDate || paymentMethodFilter || categoryFilter || dateType !== 'vencimento' || valueMin || valueMax
  const activeFilterCount = [statusFilter, paymentMethodFilter, categoryFilter, startDate || endDate ? 'date' : '', valueMin || valueMax ? 'value' : '', dateType !== 'vencimento' ? 'dateType' : ''].filter(Boolean).length
  const contaToDelete = contas.find(c => c.id === deleteId)
  const contaBaixa = contas.find(c => c.id === baixaId)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contas a Receber</h1>
          <p className="text-sm text-gray-500 mt-1">
            <Link href="/financeiro" className="text-blue-600 hover:underline">Financeiro</Link> / Contas a Receber
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-emerald-50 p-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total em Aberto</p>
                <p className="text-xl font-bold text-gray-900">{formatCurrency(summary.total_aberto)}</p>
                <p className="text-xs text-gray-400">{summary.total_aberto_count} conta(s)</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-red-50 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Vencidas</p>
                <p className="text-xl font-bold text-red-600">{formatCurrency(summary.total_vencidas)}</p>
                <p className="text-xs text-gray-400">{summary.total_vencidas_count} conta(s)</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-50 p-2">
                <CalendarClock className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Vencem Hoje</p>
                <p className="text-xl font-bold text-amber-600">{formatCurrency(summary.vencendo_hoje)}</p>
                <p className="text-xs text-gray-400">{summary.vencendo_hoje_count} conta(s)</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-50 p-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Recebidas no Mes</p>
                <p className="text-xl font-bold text-green-600">{formatCurrency(summary.recebidas_mes)}</p>
                <p className="text-xs text-gray-400">{summary.recebidas_mes_count} conta(s)</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Row 1: Search + Counter + Actions */}
      <div className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[250px]">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                id="search-receivable"
                placeholder="Buscar por descricao, cliente..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              <strong className="text-gray-700">{total}</strong> conta{total !== 1 ? 's' : ''} {' '}
              <span className="text-gray-400">—</span>{' '}
              <strong className="text-gray-700">{formatCurrency(filteredSum)}</strong>
            </span>
            <button
              type="button"
              onClick={() => setShowFilters(v => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                showFilters ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
              {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {isAdmin && selected.size > 0 && (
              <button type="button" onClick={() => setShowBulkDelete(true)}
                className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
                <Trash2 className="h-4 w-4" /> Excluir {selected.size}
              </button>
            )}
            <Link
              href="/financeiro/contas-receber/novo"
              className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" /> Nova Conta
            </Link>
          </div>
        </div>

        {/* Row 2: Advanced Filters (collapsible) */}
        {showFilters && (
          <div className="flex flex-wrap items-end gap-3 pt-3 border-t">
            <div className="min-w-[130px]">
              <label htmlFor="status-filter-receivable" className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select
                id="status-filter-receivable"
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                className="w-full rounded-md border bg-white py-1.5 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Todos</option>
                <option value="PENDENTE">Pendente</option>
                <option value="VENCIDO">Vencido</option>
                <option value="RECEBIDO">Recebido</option>
                <option value="CANCELADO">Cancelado</option>
              </select>
            </div>
            <div className="min-w-[150px]">
              <label htmlFor="payment-method-filter" className="block text-xs font-medium text-gray-500 mb-1">Forma pgto</label>
              <select
                id="payment-method-filter"
                value={paymentMethodFilter}
                onChange={e => { setPaymentMethodFilter(e.target.value); setPage(1) }}
                className="w-full rounded-md border bg-white py-1.5 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Todas</option>
                {paymentMethods.map(pm => (
                  <option key={pm.id} value={pm.name}>{pm.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[140px]">
              <label htmlFor="category-filter" className="block text-xs font-medium text-gray-500 mb-1">Categoria</label>
              <select
                id="category-filter"
                value={categoryFilter}
                onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
                className="w-full rounded-md border bg-white py-1.5 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Todas</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-1.5">
              <div className="min-w-[110px]">
                <label htmlFor="date-type-filter" className="block text-xs font-medium text-gray-500 mb-1">Data tipo</label>
                <select
                  id="date-type-filter"
                  value={dateType}
                  onChange={e => { setDateType(e.target.value); setPage(1) }}
                  className="w-full rounded-md border bg-white py-1.5 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="vencimento">Vencimento</option>
                  <option value="emissao">Emissao</option>
                  <option value="pagamento">Pagamento</option>
                </select>
              </div>
              <div className="min-w-[120px]">
                <label htmlFor="start-date-receivable" className="block text-xs font-medium text-gray-500 mb-1">De</label>
                <input
                  id="start-date-receivable"
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setPage(1) }}
                  className="w-full rounded-md border bg-white py-1.5 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="min-w-[120px]">
                <label htmlFor="end-date-receivable" className="block text-xs font-medium text-gray-500 mb-1">Ate</label>
                <input
                  id="end-date-receivable"
                  type="date"
                  value={endDate}
                  onChange={e => { setEndDate(e.target.value); setPage(1) }}
                  className="w-full rounded-md border bg-white py-1.5 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
            <div className="flex items-end gap-1.5">
              <div className="w-[100px]">
                <label htmlFor="value-min-filter" className="block text-xs font-medium text-gray-500 mb-1">De R$</label>
                <input
                  id="value-min-filter"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  value={valueMin}
                  onChange={e => { setValueMin(e.target.value); setPage(1) }}
                  className="w-full rounded-md border bg-white py-1.5 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="w-[100px]">
                <label htmlFor="value-max-filter" className="block text-xs font-medium text-gray-500 mb-1">Ate R$</label>
                <input
                  id="value-max-filter"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  value={valueMax}
                  onChange={e => { setValueMax(e.target.value); setPage(1) }}
                  className="w-full rounded-md border bg-white py-1.5 px-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-emerald-600 hover:text-emerald-700 hover:underline"
              >
                <X className="h-3 w-3" /> Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              {isAdmin && (
                <th className="px-3 py-3 w-10">
                  <input type="checkbox" title="Selecionar todos"
                    checked={contas.length > 0 && selected.size === contas.length}
                    onChange={toggleAll} className="rounded text-blue-600" />
                </th>
              )}
              <th className="px-4 py-3">Descricao</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={isAdmin ? 8 : 7} className="px-4 py-8 text-center text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <Clock className="h-4 w-4 animate-spin" /> Carregando...
                  </div>
                </td>
              </tr>
            ) : contas.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 8 : 7} className="px-4 py-8 text-center text-gray-400">
                  {hasFilters ? 'Nenhuma conta encontrada com os filtros aplicados' : 'Nenhuma conta a receber cadastrada'}
                </td>
              </tr>
            ) : (
              contas.map(conta => {
                const displayStatus = getDisplayStatus(conta)
                const config = statusConfig[displayStatus] || statusConfig.PENDENTE
                return (
                  <tr key={conta.id} className={`hover:bg-gray-50 group ${selected.has(conta.id) ? 'bg-blue-50' : ''}`}>
                    {isAdmin && (
                      <td className="px-3 py-3">
                        <input type="checkbox" title={`Selecionar ${conta.description}`}
                          checked={selected.has(conta.id)} onChange={() => toggleSelect(conta.id)}
                          className="rounded text-blue-600" />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{conta.description}</p>
                      {conta.notes && (
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{conta.notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {conta.customers?.legal_name || '--'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {conta.categories?.name || '--'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {formatDate(conta.due_date)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-gray-900">{formatCurrency(conta.total_amount)}</p>
                      {(conta.received_amount || 0) > 0 && conta.status !== 'RECEBIDO' && (
                        <p className="text-xs text-green-600">Recebido: {formatCurrency(conta.received_amount || 0)}</p>
                      )}
                      {conta.anticipated_at && conta.anticipation_fee != null && (
                        <p className="text-xs text-purple-600">Taxa: -{formatCurrency(conta.anticipation_fee)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', config.color)}>
                          {config.label}
                        </span>
                        {conta.anticipated_at && (
                          <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-800">
                            Antecipado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => router.push(`/financeiro/contas-receber/${conta.id}`)}
                          title="Ver detalhes"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-emerald-600"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {conta.status === 'PENDENTE' && (
                          <button
                            type="button"
                            onClick={() => openBaixa(conta)}
                            title="Registrar recebimento"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-green-600"
                          >
                            <DollarSign className="h-4 w-4" />
                          </button>
                        )}
                        {canAnticipate(conta) && (
                          <button
                            type="button"
                            onClick={() => openAntecipar(conta.id)}
                            title="Antecipar recebiveis"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-purple-600"
                          >
                            <Zap className="h-4 w-4" />
                          </button>
                        )}
                        {isAdmin && conta.status !== 'RECEBIDO' && (
                          <button
                            type="button"
                            onClick={() => router.push(`/financeiro/contas-receber/${conta.id}/editar`)}
                            title="Editar"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-amber-600"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setDeleteId(conta.id)}
                            title="Excluir"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
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
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Mostrando {((page - 1) * 20) + 1} - {Math.min(page * 20, total)} de {total} resultados
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
            >
              Anterior
            </button>
            <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
            >
              Proxima
            </button>
          </div>
        </div>
      )}

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

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Excluir conta a receber?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Tem certeza que deseja excluir <strong>{contaToDelete?.description}</strong>?
              {contaToDelete && <span className="block mt-1 text-gray-500">Valor: {formatCurrency(contaToDelete.total_amount)}</span>}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete modal */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBulkDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-red-600 mb-2">Excluir {selected.size} contas a receber?</h2>
            <p className="text-sm text-gray-600 mb-2">Esta ação não pode ser desfeita.</p>
            <p className="text-sm text-gray-500 mb-4">
              {contas.filter(c => selected.has(c.id)).map(c => c.description).join(', ')}
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

      {/* Anticipation Modal */}
      {antecipId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setAntecipId(null); setAntecipPreview(null) }}>
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 text-purple-600" /> Antecipar Recebiveis
            </h2>
            {antecipLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" /> Calculando...
              </div>
            ) : antecipPreview ? (
              <>
                <div className="overflow-x-auto rounded-md border mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Valor</th>
                        <th className="px-3 py-2">Vencimento</th>
                        <th className="px-3 py-2 text-right">Dias restantes</th>
                        <th className="px-3 py-2 text-right">Taxa</th>
                        <th className="px-3 py-2 text-right">Valor liquido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {antecipPreview.installments.map(inst => (
                        <tr key={inst.number} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{inst.number}</td>
                          <td className="px-3 py-2">{formatCurrency(inst.amount)}</td>
                          <td className="px-3 py-2">{formatDate(inst.due_date)}</td>
                          <td className="px-3 py-2 text-right">{inst.days_remaining}</td>
                          <td className="px-3 py-2 text-right text-red-600">-{formatCurrency(inst.fee)}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(inst.net_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 rounded-md bg-gray-50 p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Valor total</span>
                    <span className="font-medium">{formatCurrency(antecipPreview.total_amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Taxa de antecipacao ({antecipPreview.fee_pct_per_day}%/dia)</span>
                    <span className="font-medium text-red-600">-{formatCurrency(antecipPreview.total_fee)}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t pt-2">
                    <span className="font-semibold text-gray-900">Valor a receber</span>
                    <span className="font-bold text-green-600 text-base">{formatCurrency(antecipPreview.anticipated_amount)}</span>
                  </div>
                </div>
                <div className="flex gap-3 justify-end mt-5">
                  <button
                    type="button"
                    onClick={() => { setAntecipId(null); setAntecipPreview(null) }}
                    className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleAntecipar}
                    disabled={antecipConfirming}
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {antecipConfirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {antecipConfirming ? 'Antecipando...' : 'Confirmar Antecipacao'}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-red-500 py-4">Erro ao carregar preview.</p>
            )}
          </div>
        </div>
      )}

      {/* Baixa (Receipt) Modal */}
      {baixaId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBaixaId(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Registrar Recebimento</h2>
            {contaBaixa && (
              <p className="text-sm text-gray-500 mb-4">
                {contaBaixa.description} - Total: {formatCurrency(contaBaixa.total_amount)}
                {(contaBaixa.received_amount || 0) > 0 && (
                  <span className="block text-green-600">Ja recebido: {formatCurrency(contaBaixa.received_amount || 0)}</span>
                )}
              </p>
            )}
            <div className="space-y-3">
              <div>
                <label htmlFor="baixa-amount-receivable" className="block text-sm text-gray-600 mb-1">Valor recebido (R$) *</label>
                <input
                  id="baixa-amount-receivable"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={baixaAmount}
                  onChange={e => setBaixaAmount(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <label htmlFor="baixa-date-receivable" className="block text-sm text-gray-600 mb-1">Data do recebimento</label>
                <input
                  id="baixa-date-receivable"
                  type="date"
                  value={baixaDate}
                  onChange={e => setBaixaDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
              <div>
                <label htmlFor="baixa-account-receivable" className="block text-sm text-gray-600 mb-1">Conta bancaria</label>
                <select
                  id="baixa-account-receivable"
                  value={baixaAccountId}
                  onChange={e => setBaixaAccountId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                >
                  <option value="">Nenhuma (nao movimentar saldo)</option>
                  {bankAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}{acc.bank_name ? ` - ${acc.bank_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-5">
              <button
                type="button"
                onClick={() => setBaixaId(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleBaixa}
                disabled={baixaLoading}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
              >
                {baixaLoading ? 'Registrando...' : 'Confirmar Recebimento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
