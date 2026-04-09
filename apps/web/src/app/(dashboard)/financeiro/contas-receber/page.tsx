'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Plus, Search, Eye, Pencil, Trash2, DollarSign,
  AlertTriangle, Clock, CheckCircle2, CalendarClock, X, Loader2, Zap,
  Filter, ChevronDown, ChevronUp, Combine, Unlink,
  Columns3, Printer, FileSpreadsheet, Mail, Receipt, Send
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
  group_id: string | null
  grouped_into_id: string | null
  boleto_url: string | null
  customer_id: string | null
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
  if (!dateStr) return '--'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

const statusConfig: Record<string, { label: string; color: string }> = {
  PENDENTE: { label: 'Pendente', color: 'bg-blue-100 text-blue-800' },
  VENCIDO: { label: 'Vencido', color: 'bg-red-100 text-red-800' },
  RECEBIDO: { label: 'Recebido', color: 'bg-green-100 text-green-800' },
  CANCELADO: { label: 'Cancelado', color: 'bg-gray-100 text-gray-500' },
  AGRUPADO: { label: 'Agrupado', color: 'bg-purple-100 text-purple-800' },
}

export default function ContasReceberPage() {
  const router = useRouter()
  const urlParams = useSearchParams()
  const { isAdmin } = useAuth()
  const [contas, setContas] = useState<ContaReceber[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)

  // Filters (inicializar da URL se vier de outra pagina)
  const [search, setSearch] = useState(urlParams.get('search') || '')
  const [customerIdFilter] = useState(urlParams.get('customerId') || '')
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

  // Boleto modal
  const [boletoModalConta, setBoletoModalConta] = useState<ContaReceber | null>(null)
  const [boletoBank, setBoletoBank] = useState('inter')
  const [boletoGenerating, setBoletoGenerating] = useState(false)
  const [antecipPreview, setAntecipPreview] = useState<AnticipationPreview | null>(null)
  const [antecipLoading, setAntecipLoading] = useState(false)
  const [antecipConfirming, setAntecipConfirming] = useState(false)

  // Cobranca (Asaas charge) modal
  const [cobrancaConta, setCobrancaConta] = useState<ContaReceber | null>(null)
  const [cobrancaBillingType, setCobrancaBillingType] = useState<'PIX' | 'BOLETO' | 'CREDIT_CARD'>('PIX')
  const [cobrancaSendWhatsapp, setCobrancaSendWhatsapp] = useState(true)
  const [cobrancaSendEmail, setCobrancaSendEmail] = useState(true)
  const [cobrancaInstallments, setCobrancaInstallments] = useState(1)
  const [cobrancaLoading, setCobrancaLoading] = useState(false)
  const [cobrancaResult, setCobrancaResult] = useState<{ invoice_url: string; billing_type: string } | null>(null)

  // Column toggle
  const [showColToggle, setShowColToggle] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('cr_hidden_columns')
        if (stored) return new Set(JSON.parse(stored))
      } catch {}
    }
    return new Set()
  })

  const allColumns = [
    { key: 'description', label: 'Descricao' },
    { key: 'customer', label: 'Cliente' },
    { key: 'category', label: 'Categoria' },
    { key: 'due_date', label: 'Vencimento' },
    { key: 'total_amount', label: 'Valor' },
    { key: 'status', label: 'Status' },
  ] as const

  function toggleColumn(key: string) {
    setHiddenColumns(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      localStorage.setItem('cr_hidden_columns', JSON.stringify(Array.from(next)))
      return next
    })
  }

  function isColVisible(key: string) {
    return !hiddenColumns.has(key)
  }

  // Export helpers
  function handlePrint() {
    const rows = selectedContas.length > 0 ? selectedContas : contas
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Contas a Receber</title>
      <style>body{font-family:Arial,sans-serif;margin:20px}table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #ccc;padding:8px 12px;text-align:left;font-size:13px}
      th{background:#f5f5f5;font-weight:600}h1{font-size:18px;margin-bottom:4px}
      .right{text-align:right}.total-row{font-weight:bold;background:#f9f9f9}
      @media print{button{display:none}}</style></head><body>
      <h1>Contas a Receber</h1>
      <p style="color:#666;font-size:12px;margin-bottom:12px">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
      <table><thead><tr>
      ${isColVisible('description') ? '<th>Descricao</th>' : ''}
      ${isColVisible('customer') ? '<th>Cliente</th>' : ''}
      ${isColVisible('category') ? '<th>Categoria</th>' : ''}
      ${isColVisible('due_date') ? '<th>Vencimento</th>' : ''}
      ${isColVisible('total_amount') ? '<th class="right">Valor</th>' : ''}
      ${isColVisible('status') ? '<th>Status</th>' : ''}
      </tr></thead><tbody>
      ${rows.map(c => `<tr>
        ${isColVisible('description') ? `<td>${c.description}</td>` : ''}
        ${isColVisible('customer') ? `<td>${c.customers?.legal_name || '--'}</td>` : ''}
        ${isColVisible('category') ? `<td>${c.categories?.name || '--'}</td>` : ''}
        ${isColVisible('due_date') ? `<td>${formatDate(c.due_date)}</td>` : ''}
        ${isColVisible('total_amount') ? `<td class="right">${formatCurrency(c.total_amount)}</td>` : ''}
        ${isColVisible('status') ? `<td>${(statusConfig[getDisplayStatus(c)] || statusConfig.PENDENTE).label}</td>` : ''}
      </tr>`).join('')}
      <tr class="total-row">
        <td colspan="${allColumns.filter(col => isColVisible(col.key)).length - (isColVisible('total_amount') ? 1 : 0)}">Total</td>
        ${isColVisible('total_amount') ? `<td class="right">${formatCurrency(rows.reduce((s, c) => s + c.total_amount, 0))}</td>` : ''}
        ${isColVisible('status') ? '<td></td>' : ''}
      </tr>
      </tbody></table></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  function handleCSV() {
    const rows = selectedContas.length > 0 ? selectedContas : contas
    const sep = ';'
    const headers: string[] = []
    if (isColVisible('description')) headers.push('Descricao')
    if (isColVisible('customer')) headers.push('Cliente')
    if (isColVisible('category')) headers.push('Categoria')
    if (isColVisible('due_date')) headers.push('Vencimento')
    if (isColVisible('total_amount')) headers.push('Valor')
    if (isColVisible('status')) headers.push('Status')

    const csvRows = [headers.join(sep)]
    for (const c of rows) {
      const cells: string[] = []
      if (isColVisible('description')) cells.push(`"${c.description.replace(/"/g, '""')}"`)
      if (isColVisible('customer')) cells.push(`"${(c.customers?.legal_name || '--').replace(/"/g, '""')}"`)
      if (isColVisible('category')) cells.push(`"${(c.categories?.name || '--').replace(/"/g, '""')}"`)
      if (isColVisible('due_date')) cells.push(formatDate(c.due_date))
      if (isColVisible('total_amount')) cells.push((c.total_amount / 100).toFixed(2).replace('.', ','))
      if (isColVisible('status')) cells.push((statusConfig[getDisplayStatus(c)] || statusConfig.PENDENTE).label)
      csvRows.push(cells.join(sep))
    }

    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contas-receber-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleEmail() {
    const rows = selectedContas.length > 0 ? selectedContas : contas
    const total = rows.reduce((s, c) => s + c.total_amount, 0)
    const subject = encodeURIComponent(`Contas a Receber - ${formatCurrency(total)}`)
    const lines = rows.map(c =>
      `- ${c.description} | ${c.customers?.legal_name || '--'} | ${formatDate(c.due_date)} | ${formatCurrency(c.total_amount)} | ${(statusConfig[getDisplayStatus(c)] || statusConfig.PENDENTE).label}`
    )
    const body = encodeURIComponent(`Contas a Receber\nGerado em ${new Date().toLocaleString('pt-BR')}\n\n${lines.join('\n')}\n\nTotal: ${formatCurrency(total)}`)
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  // Agrupar modal
  const [showAgrupar, setShowAgrupar] = useState(false)
  const [agruparPaymentMethod, setAgruparPaymentMethod] = useState('')
  const [agruparNotes, setAgruparNotes] = useState('')
  const [agruparLoading, setAgruparLoading] = useState(false)
  const [desagruparLoading, setDesagruparLoading] = useState(false)

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
    if (customerIdFilter) params.set('customerId', customerIdFilter)

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
  }, [page, search, statusFilter, startDate, endDate, paymentMethodFilter, categoryFilter, dateType, valueMin, valueMax, customerIdFilter])

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

  async function handleGerarBoleto() {
    const conta = boletoModalConta
    if (!conta || boletoGenerating) return

    setBoletoGenerating(true)
    try {
      // Gerar remessa CNAB 400 para esta conta específica
      const res = await fetch(`/api/financeiro/cnab?ids=${conta.id}`)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao gerar remessa')
      }

      // Download do arquivo .REM
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'remessa.rem'
      a.click()
      URL.revokeObjectURL(url)

      // Enviar por email ao cliente
      if (conta.customers) {
        try {
          await fetch('/api/financeiro/boletos/enviar-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receivable_id: conta.id }),
          })
          toast.success(`Remessa gerada e email enviado para ${conta.customers.legal_name}!`)
        } catch {
          toast.success('Remessa gerada! (email nao enviado)')
        }
      } else {
        toast.success('Arquivo de remessa CNAB gerado! Faca upload no Internet Banking do Inter.')
      }

      setBoletoModalConta(null)
      loadContas()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar remessa')
    } finally {
      setBoletoGenerating(false)
    }
  }

  function openCobranca(conta: ContaReceber) {
    setCobrancaConta(conta)
    setCobrancaBillingType('PIX')
    setCobrancaSendWhatsapp(true)
    setCobrancaSendEmail(true)
    setCobrancaInstallments(1)
    setCobrancaResult(null)
  }

  async function handleCobranca() {
    if (!cobrancaConta || cobrancaLoading) return
    setCobrancaLoading(true)
    try {
      const res = await fetch('/api/financeiro/cobranca/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivable_id: cobrancaConta.id,
          billing_type: cobrancaBillingType,
          send_whatsapp: cobrancaSendWhatsapp,
          send_email: cobrancaSendEmail,
          installment_count: cobrancaBillingType === 'CREDIT_CARD' ? cobrancaInstallments : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409 && data.payment?.invoice_url) {
          setCobrancaResult({ invoice_url: data.payment.invoice_url, billing_type: data.payment.billing_type })
          toast.info('Cobranca ja existente — link disponivel')
          return
        }
        throw new Error(data.error || 'Erro ao criar cobranca')
      }
      setCobrancaResult({ invoice_url: data.payment.invoice_url, billing_type: data.payment.billing_type })
      const channels = []
      if (data.sent_whatsapp) channels.push('WhatsApp')
      if (data.sent_email) channels.push('Email')
      toast.success(`Cobranca criada${channels.length ? ` e enviada via ${channels.join(' + ')}` : ''}!`)
      loadContas()
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar cobranca')
    } finally {
      setCobrancaLoading(false)
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

  // Check if selected receivables can be grouped (all PENDENTE, 2+ selected)
  const canGroup = selected.size >= 2 && Array.from(selected).every(id => {
    const conta = contas.find(c => c.id === id)
    return conta && conta.status === 'PENDENTE' && !conta.grouped_into_id
  })

  const selectedContas = contas.filter(c => selected.has(c.id))
  const selectedTotal = selectedContas.reduce((sum, c) => sum + c.total_amount, 0)

  function openAgrupar() {
    setAgruparPaymentMethod('')
    setAgruparNotes('')
    setShowAgrupar(true)
  }

  async function handleAgrupar() {
    setAgruparLoading(true)
    try {
      const res = await fetch('/api/financeiro/contas-receber/agrupar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivable_ids: Array.from(selected),
          payment_method: agruparPaymentMethod || undefined,
          notes: agruparNotes || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao agrupar')
      toast.success('Contas agrupadas com sucesso')
      setShowAgrupar(false)
      setSelected(new Set())
      loadContas()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao agrupar')
    } finally {
      setAgruparLoading(false)
    }
  }

  async function handleDesagrupar(contaId: string) {
    setDesagruparLoading(true)
    try {
      const res = await fetch('/api/financeiro/contas-receber/desagrupar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_receivable_id: contaId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao desagrupar')
      toast.success('Contas desagrupadas com sucesso')
      loadContas()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao desagrupar')
    } finally {
      setDesagruparLoading(false)
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColToggle(v => !v)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  showColToggle ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                )}
              >
                <Columns3 className="h-3.5 w-3.5" />
                Colunas
              </button>
              {showColToggle && (
                <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColToggle(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-md border bg-white shadow-lg py-1">
                  {allColumns.map(col => (
                    <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isColVisible(col.key)}
                        onChange={() => toggleColumn(col.key)}
                        className="rounded text-emerald-600"
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
                </>
              )}
            </div>
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
                <option value="AGRUPADO">Agrupado</option>
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
              {isColVisible('description') && <th className="px-4 py-3">Descricao</th>}
              {isColVisible('customer') && <th className="px-4 py-3">Cliente</th>}
              {isColVisible('category') && <th className="px-4 py-3">Categoria</th>}
              {isColVisible('due_date') && <th className="px-4 py-3">Vencimento</th>}
              {isColVisible('total_amount') && <th className="px-4 py-3 text-right">Valor</th>}
              {isColVisible('status') && <th className="px-4 py-3 text-center">Status</th>}
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={99} className="px-4 py-8 text-center text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <Clock className="h-4 w-4 animate-spin" /> Carregando...
                  </div>
                </td>
              </tr>
            ) : contas.length === 0 ? (
              <tr>
                <td colSpan={99} className="px-4 py-8 text-center text-gray-400">
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
                    {isColVisible('description') && (
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{conta.description}</p>
                      {conta.notes && (
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{conta.notes}</p>
                      )}
                    </td>
                    )}
                    {isColVisible('customer') && (
                    <td className="px-4 py-3 text-gray-500">
                      {conta.customers?.legal_name || '--'}
                    </td>
                    )}
                    {isColVisible('category') && (
                    <td className="px-4 py-3 text-gray-500">
                      {conta.categories?.name || '--'}
                    </td>
                    )}
                    {isColVisible('due_date') && (
                    <td className="px-4 py-3 text-gray-700">
                      {formatDate(conta.due_date)}
                    </td>
                    )}
                    {isColVisible('total_amount') && (
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-gray-900">{formatCurrency(conta.total_amount)}</p>
                      {(conta.received_amount || 0) > 0 && conta.status !== 'RECEBIDO' && (
                        <p className="text-xs text-green-600">Recebido: {formatCurrency(conta.received_amount || 0)}</p>
                      )}
                      {conta.anticipated_at && conta.anticipation_fee != null && (
                        <p className="text-xs text-purple-600">Taxa: -{formatCurrency(conta.anticipation_fee)}</p>
                      )}
                    </td>
                    )}
                    {isColVisible('status') && (
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
                        {conta.status === 'AGRUPADO' && conta.grouped_into_id && (
                          <button
                            type="button"
                            onClick={() => router.push(`/financeiro/contas-receber/${conta.grouped_into_id}`)}
                            className="text-xs text-purple-600 hover:text-purple-800 underline"
                          >
                            Ver agrupamento
                          </button>
                        )}
                        {conta.group_id && !conta.grouped_into_id && (
                          <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                            Grupo
                          </span>
                        )}
                      </div>
                    </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => router.push(`/financeiro/contas-receber/${conta.id}`)}
                          title="Ver detalhes"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-emerald-600"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {(displayStatus === 'PENDENTE' || displayStatus === 'VENCIDO') && (
                          <button
                            type="button"
                            onClick={() => openBaixa(conta)}
                            title="Registrar recebimento (Baixar)"
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
                        {isAdmin && conta.group_id && !conta.grouped_into_id && conta.status !== 'RECEBIDO' && (
                          <button
                            type="button"
                            onClick={() => handleDesagrupar(conta.id)}
                            disabled={desagruparLoading}
                            title="Desagrupar contas"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-purple-600"
                          >
                            <Unlink className="h-4 w-4" />
                          </button>
                        )}
                        {(displayStatus === 'PENDENTE' || displayStatus === 'VENCIDO') && conta.customer_id && (
                          <button
                            type="button"
                            onClick={() => openCobranca(conta)}
                            title="Enviar Cobranca (PIX/Boleto/Cartao)"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-emerald-600"
                          >
                            <Send className="h-4 w-4" />
                          </button>
                        )}
                        {(displayStatus === 'PENDENTE' || displayStatus === 'VENCIDO') && !conta.boleto_url && (
                          <button
                            type="button"
                            onClick={() => setBoletoModalConta(conta)}
                            title="Gerar Boleto CNAB"
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-orange-600"
                          >
                            <Receipt className="h-4 w-4" />
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
        <div className="sticky bottom-0 z-10 flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 shadow-lg">
          <span className="text-sm text-blue-700 font-medium">
            {selected.size} selecionada{selected.size !== 1 ? 's' : ''} — {formatCurrency(selectedTotal)}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700">Limpar selecao</button>
            <button type="button" onClick={handlePrint}
              title="Imprimir selecionadas"
              className="flex items-center gap-1.5 px-3 py-1 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700 font-medium">
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </button>
            <button type="button" onClick={handleCSV}
              title="Exportar CSV"
              className="flex items-center gap-1.5 px-3 py-1 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 font-medium">
              <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
            </button>
            <button type="button" onClick={handleEmail}
              title="Enviar por e-mail"
              className="flex items-center gap-1.5 px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium">
              <Mail className="h-3.5 w-3.5" /> Email
            </button>
            {canGroup && (
              <button type="button" onClick={openAgrupar}
                className="flex items-center gap-1.5 px-3 py-1 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 font-medium">
                <Combine className="h-3.5 w-3.5" /> Agrupar {selected.size}
              </button>
            )}
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

      {/* Agrupar Modal */}
      {showAgrupar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAgrupar(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
              <Combine className="h-5 w-5 text-purple-600" /> Agrupar Contas a Receber
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {selected.size} contas selecionadas serao agrupadas em uma unica conta.
            </p>

            <div className="max-h-48 overflow-y-auto rounded-md border mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-3 py-2">Descricao</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedContas.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700">{c.description}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(c.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center rounded-md bg-purple-50 p-3 mb-4">
              <span className="text-sm font-medium text-purple-800">Total do agrupamento</span>
              <span className="text-lg font-bold text-purple-900">{formatCurrency(selectedTotal)}</span>
            </div>

            <div className="space-y-3 mb-5">
              <div>
                <label htmlFor="agrupar-payment" className="block text-sm text-gray-600 mb-1">Forma de pagamento</label>
                <select
                  id="agrupar-payment"
                  value={agruparPaymentMethod}
                  onChange={e => setAgruparPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                >
                  <option value="">Usar da primeira conta</option>
                  {paymentMethods.map(pm => (
                    <option key={pm.id} value={pm.name}>{pm.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="agrupar-notes" className="block text-sm text-gray-600 mb-1">Observacoes</label>
                <textarea
                  id="agrupar-notes"
                  value={agruparNotes}
                  onChange={e => setAgruparNotes(e.target.value)}
                  rows={2}
                  placeholder="Observacoes do agrupamento..."
                  className="w-full px-3 py-2 border rounded-md text-sm resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowAgrupar(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAgrupar}
                disabled={agruparLoading}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
              >
                {agruparLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {agruparLoading ? 'Agrupando...' : 'Confirmar Agrupamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Baixa (Receipt) Modal */}
      {baixaId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBaixaId(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Registrar Recebimento</h2>
            {contaBaixa && (() => {
              const received = contaBaixa.received_amount || 0
              const total = contaBaixa.total_amount
              const remaining = total - received
              const progressPct = total > 0 ? Math.min(100, (received / total) * 100) : 0
              const enteredAmount = Math.round(Number(baixaAmount) * 100)
              const willBePartial = enteredAmount > 0 && (received + enteredAmount) < total

              return (
                <div className="mb-4">
                  <p className="text-sm text-gray-500">
                    {contaBaixa.description} - Total: {formatCurrency(total)}
                  </p>
                  {received > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span className="text-green-600">Ja recebido: {formatCurrency(received)}</span>
                        <span>Restante: {formatCurrency(remaining)}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-green-500 h-2 rounded-full transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {willBePartial && (
                    <p className="mt-2 text-xs font-medium text-amber-600 bg-amber-50 rounded px-2 py-1 inline-block">
                      Pagamento parcial - restara {formatCurrency(remaining - enteredAmount)}
                    </p>
                  )}
                </div>
              )
            })()}
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

      {/* ===== BOLETO MODAL ===== */}
      {boletoModalConta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !boletoGenerating && setBoletoModalConta(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Receipt className="h-5 w-5 text-orange-600" />
                Gerar Boleto e Enviar
              </h2>
              <button type="button" title="Fechar" onClick={() => setBoletoModalConta(null)} disabled={boletoGenerating}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Cliente:</span><span className="font-medium">{boletoModalConta.customers?.legal_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Valor:</span><span className="font-bold text-green-700">{formatCurrency(boletoModalConta.total_amount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Vencimento:</span><span>{formatDate(boletoModalConta.due_date)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Descricao:</span><span>{boletoModalConta.description}</span></div>
              </div>

              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                <strong>Banco Inter — CNAB 400</strong>
                <p className="mt-1 text-xs text-orange-700">
                  Sera gerado um arquivo .REM para upload no Internet Banking do Inter.
                  O banco registra o boleto e envia por email ao pagador automaticamente.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button type="button" onClick={handleGerarBoleto} disabled={boletoGenerating}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">
                {boletoGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                {boletoGenerating ? 'Gerando...' : 'Gerar Remessa CNAB'}
              </button>
              <button type="button" onClick={() => setBoletoModalConta(null)} disabled={boletoGenerating}
                className="px-4 py-2.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== COBRANCA ASAAS MODAL ===== */}
      {cobrancaConta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !cobrancaLoading && setCobrancaConta(null)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Send className="h-5 w-5 text-emerald-600" />
                Enviar Cobranca
              </h2>
              <button type="button" title="Fechar" onClick={() => setCobrancaConta(null)} disabled={cobrancaLoading}
                className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
            </div>

            {/* Info do recebível */}
            <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1 mb-4">
              <div className="flex justify-between"><span className="text-gray-500">Cliente:</span><span className="font-medium">{cobrancaConta.customers?.legal_name || 'Sem cliente'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Valor:</span><span className="font-bold text-emerald-700">{formatCurrency(cobrancaConta.total_amount - (cobrancaConta.received_amount || 0))}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Vencimento:</span><span>{formatDate(cobrancaConta.due_date)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Descricao:</span><span className="text-right max-w-[200px] truncate">{cobrancaConta.description}</span></div>
            </div>

            {cobrancaResult ? (
              /* Sucesso — mostrar link */
              <div className="space-y-4">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-emerald-800 mb-2">Cobranca criada com sucesso!</p>
                  <a
                    href={cobrancaResult.invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-emerald-600 underline break-all"
                  >
                    {cobrancaResult.invoice_url}
                  </a>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(cobrancaResult.invoice_url)
                      toast.success('Link copiado!')
                    }}
                    className="flex-1 px-4 py-2.5 text-sm border rounded-lg hover:bg-gray-50 font-medium"
                  >
                    Copiar Link
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCobrancaConta(null); setCobrancaResult(null) }}
                    className="flex-1 px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              /* Form — escolher tipo e canais */
              <div className="space-y-4">
                {/* Tipo de pagamento */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Forma de pagamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'PIX' as const, label: 'PIX', icon: '⚡', active: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
                      { value: 'BOLETO' as const, label: 'Boleto', icon: '📄', active: 'border-blue-500 bg-blue-50 text-blue-700' },
                      { value: 'CREDIT_CARD' as const, label: 'Cartao', icon: '💳', active: 'border-purple-500 bg-purple-50 text-purple-700' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setCobrancaBillingType(opt.value)}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-sm font-medium transition-all',
                          cobrancaBillingType === opt.value
                            ? opt.active
                            : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        )}
                      >
                        <span className="text-xl">{opt.icon}</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Parcelamento (só para cartão) */}
                {cobrancaBillingType === 'CREDIT_CARD' && (
                  <div>
                    <label htmlFor="cobranca-installments" className="block text-sm text-gray-600 mb-1">Parcelas</label>
                    <select
                      id="cobranca-installments"
                      value={cobrancaInstallments}
                      onChange={e => setCobrancaInstallments(Number(e.target.value))}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>
                          {n}x de {formatCurrency(Math.ceil((cobrancaConta.total_amount - (cobrancaConta.received_amount || 0)) / n))}
                          {n === 1 ? ' (a vista)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Canais de envio */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Enviar link via</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cobrancaSendWhatsapp}
                        onChange={e => setCobrancaSendWhatsapp(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span>WhatsApp</span>
                      {!cobrancaConta.customers && <span className="text-xs text-gray-400">(sem telefone)</span>}
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cobrancaSendEmail}
                        onChange={e => setCobrancaSendEmail(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span>Email</span>
                    </label>
                  </div>
                </div>

                {/* Info do Asaas */}
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <strong>Asaas — Gateway de Pagamento</strong>
                  <p className="mt-1 text-xs text-emerald-700">
                    {cobrancaBillingType === 'PIX' && 'Sera gerado um QR Code PIX. O cliente recebe o link e paga instantaneamente.'}
                    {cobrancaBillingType === 'BOLETO' && 'Sera gerado um boleto bancario. O cliente recebe o link para pagar online ou imprimir.'}
                    {cobrancaBillingType === 'CREDIT_CARD' && 'O cliente recebe o link e paga com cartao de credito (com ou sem parcelamento).'}
                    {' '}Pagamento confirmado automaticamente via webhook.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleCobranca}
                    disabled={cobrancaLoading}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {cobrancaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {cobrancaLoading ? 'Criando cobranca...' : 'Criar e Enviar Cobranca'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCobrancaConta(null)}
                    disabled={cobrancaLoading}
                    className="px-4 py-2.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
