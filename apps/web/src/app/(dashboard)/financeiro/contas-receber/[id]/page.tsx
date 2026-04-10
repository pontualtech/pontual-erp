'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft, Loader2, Trash2, CheckCircle, Zap, FileText,
  Download, Printer, RefreshCw, Building2, CreditCard, User, Hash,
  ClipboardList, Combine, ExternalLink, CheckSquare, Square, AlertTriangle,
  Banknote, Receipt, Pencil, Save, X, Calendar, DollarSign, Tag,
  Wallet, QrCode, FileBarChart, Landmark, Coins, Smartphone, Undo2
} from 'lucide-react'
import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────
interface ContaReceber {
  id: string; description: string; total_amount: number; received_amount: number
  due_date: string; status: string; payment_method: string | null; notes: string | null
  installment_count: number | null
  boleto_url: string | null; pix_code: string | null
  anticipated_at: string | null; anticipation_fee: number | null; anticipated_amount: number | null
  group_id: string | null; grouped_into_id: string | null
  charge_id: string | null; charge_status: string | null; charge_url: string | null
  category_id: string | null
  created_at: string; categories: { id: string; name: string } | null
  customers: { id: string; legal_name: string; document_number?: string } | null
  service_orders: { id: string; os_number: number } | null
}

interface Installment {
  id: string; installment_number: number; amount: number; due_date: string
  status: string; paid_at: string | null
}

interface BankAccount { id: string; name: string; bank_name: string | null }
interface CategoryItem { id: string; name: string }

interface OtherPending {
  id: string; description: string; total_amount: number; due_date: string
  payment_method: string | null
  service_orders: { id: string; os_number: number } | null
}

interface GroupedItem {
  id: string; description: string; total_amount: number; due_date: string
  service_orders: { id: string; os_number: number } | null
}

// ─── Helpers ─────────────────────────────────
function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function safeDate(v: any, utc = false): string {
  if (!v) return '--'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('pt-BR', utc ? { timeZone: 'UTC' } : undefined)
}

const PAYMENT_METHODS = [
  { value: 'PIX', label: 'PIX', icon: QrCode, color: 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800' },
  { value: 'Boleto', label: 'Boleto', icon: FileBarChart, color: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950 dark:border-orange-800' },
  { value: 'Cartão Crédito', label: 'Cartao Credito', icon: CreditCard, color: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800' },
  { value: 'Cartão Débito', label: 'Cartao Debito', icon: CreditCard, color: 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-950 dark:border-indigo-800' },
  { value: 'Dinheiro', label: 'Dinheiro', icon: Coins, color: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800' },
  { value: 'Transferência', label: 'Transferencia', icon: Landmark, color: 'text-purple-600 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950 dark:border-purple-800' },
  { value: 'Link de Pagamento', label: 'Link Pagamento', icon: Smartphone, color: 'text-pink-600 bg-pink-50 border-pink-200 dark:text-pink-400 dark:bg-pink-950 dark:border-pink-800' },
]

const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  PENDENTE: { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500', label: 'Pendente' },
  VENCIDO: { bg: 'bg-red-50 dark:bg-red-950', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500', label: 'Vencido' },
  RECEBIDO: { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500', label: 'Recebido' },
  PAGO: { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500', label: 'Pago' },
  CANCELADO: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400', label: 'Cancelado' },
  AGRUPADO: { bg: 'bg-purple-50 dark:bg-purple-950', text: 'text-purple-700 dark:text-purple-400', dot: 'bg-purple-500', label: 'Agrupado' },
}

// ─── Component ───────────────────────────────
export default function ContaReceberDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { isAdmin, hasPermission } = useAuth()
  const canEdit = isAdmin || hasPermission('financeiro', 'edit')

  const [conta, setConta] = useState<ContaReceber | null>(null)
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [otherPending, setOtherPending] = useState<OtherPending[]>([])
  const [groupedItems, setGroupedItems] = useState<GroupedItem[]>([])
  const [installments, setInstallments] = useState<Installment[]>([])

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ description: '', total_amount: '', due_date: '', payment_method: '', category_id: '', notes: '' })
  const [saving, setSaving] = useState(false)

  // Modals
  const [showBaixa, setShowBaixa] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showUnificar, setShowUnificar] = useState(false)

  // Baixa
  const [baixaAmount, setBaixaAmount] = useState('')
  const [baixaDate, setBaixaDate] = useState(new Date().toISOString().split('T')[0])
  const [baixaAccountId, setBaixaAccountId] = useState('')
  const [baixaSaving, setBaixaSaving] = useState(false)

  // Other
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [unificando, setUnificando] = useState(false)
  const [reenvioLoading, setReenvioLoading] = useState(false)

  // ─── Load ──────────────────────────────────
  function loadConta() {
    fetch(`/api/financeiro/contas-receber/${id}`).then(r => r.json())
      .then(d => {
        const c = d.data
        if (!c) { toast.error('Conta nao encontrada'); router.push('/financeiro/contas-receber'); return }
        setConta(c)
        setBaixaAmount(String((c.total_amount - (c.received_amount || 0)) / 100))
        setAccounts(c.accounts ?? [])
        setOtherPending(c.other_pending ?? [])
        setGroupedItems(c.grouped_items ?? [])
        setInstallments(c.installments ?? [])
        // Populate edit form
        setEditForm({
          description: c.description,
          total_amount: String((c.total_amount || 0) / 100),
          due_date: c.due_date ? new Date(c.due_date).toISOString().split('T')[0] : '',
          payment_method: c.payment_method || '',
          category_id: c.category_id || '',
          notes: c.notes || '',
        })
      })
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadConta()
    fetch('/api/financeiro/categorias?limit=100').then(r => r.json())
      .then(d => setCategories(d.data ?? []))
      .catch(() => {})
  }, [id])

  // ─── Edit ──────────────────────────────────
  function startEditing() {
    if (!conta) return
    setEditForm({
      description: conta.description,
      total_amount: String((conta.total_amount || 0) / 100),
      due_date: conta.due_date ? new Date(conta.due_date).toISOString().split('T')[0] : '',
      payment_method: conta.payment_method || '',
      category_id: conta.category_id || '',
      notes: conta.notes || '',
    })
    setEditing(true)
  }

  async function saveEdit() {
    if (!editForm.description.trim()) { toast.error('Descricao e obrigatoria'); return }
    setSaving(true)
    try {
      const payload: any = {
        description: editForm.description.trim(),
        notes: editForm.notes.trim() || null,
        payment_method: editForm.payment_method || null,
        category_id: editForm.category_id || null,
      }
      const amt = Math.round(parseFloat(editForm.total_amount) * 100)
      if (isNaN(amt) || amt <= 0) { toast.error('Valor deve ser maior que zero'); setSaving(false); return }
      payload.total_amount = amt
      if (editForm.due_date) payload.due_date = editForm.due_date

      const res = await fetch(`/api/financeiro/contas-receber/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Conta atualizada!')
      setEditing(false)
      loadConta()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  // ─── Actions ───────────────────────────────
  async function handleBaixa() {
    setBaixaSaving(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${id}/baixa`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received_amount: Math.round(parseFloat(baixaAmount) * 100), received_at: baixaDate, account_id: baixaAccountId || undefined }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Recebimento registrado!')
      setShowBaixa(false); loadConta()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setBaixaSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Conta excluida'); router.push('/financeiro/contas-receber')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  async function handleUnificar() {
    if (selectedIds.size === 0) return
    setUnificando(true)
    try {
      const allIds = [id, ...Array.from(selectedIds)]
      const res = await fetch('/api/financeiro/contas-receber/agrupar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivable_ids: allIds }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success(`${allIds.length} contas unificadas!`)
      router.push(`/financeiro/contas-receber/${d.data.id}`)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setUnificando(false) }
  }

  async function handleReenviarRemessa() {
    if (!conta) return
    setReenvioLoading(true)
    try {
      const res = await fetch(`/api/financeiro/cnab?ids=${conta.id}`)
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Erro') }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'remessa.rem'; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Remessa gerada!'); loadConta()
    } catch (err: any) { toast.error(err.message || 'Erro') }
    finally { setReenvioLoading(false) }
  }

  // ─── Render helpers ────────────────────────
  if (loading) return <div className="flex items-center justify-center py-20 gap-2 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /> Carregando...</div>
  if (!conta) return <div className="py-20 text-center text-red-500">Conta nao encontrada</div>

  const remaining = conta.total_amount - (conta.received_amount || 0)
  const pctPaid = conta.total_amount > 0 ? ((conta.received_amount || 0) / conta.total_amount) * 100 : 0
  const isPaid = conta.status === 'RECEBIDO' || conta.status === 'PAGO'
  const isEditable = !isPaid && conta.status !== 'CANCELADO' && conta.status !== 'AGRUPADO'
  const isGroupParent = conta.group_id && !conta.grouped_into_id
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dueDay = new Date(String(conta.due_date).substring(0, 10) + 'T00:00:00')
  const isOverdue = conta.status === 'PENDENTE' && dueDay < today
  const sc = statusConfig[isOverdue ? 'VENCIDO' : conta.status] || statusConfig.PENDENTE

  const selectedTotal = Array.from(selectedIds).reduce((sum, sid) => sum + (otherPending.find(p => p.id === sid)?.total_amount || 0), 0) + conta.total_amount
  const currentPM = PAYMENT_METHODS.find(p => p.value === (editing ? editForm.payment_method : conta.payment_method))

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* ─── Header ──────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro/contas-receber" className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5 hover:bg-gray-50 dark:hover:bg-gray-800">
            <ArrowLeft className="h-4 w-4 text-gray-500" />
          </Link>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Conta a Receber</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', sc.bg, sc.text)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', sc.dot)} />
                {isOverdue ? 'Vencido' : sc.label}
              </span>
              {isGroupParent && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 px-3 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-400"><Combine className="h-3 w-3" /> Agrupamento</span>}
              {conta.anticipated_at && <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 dark:bg-purple-950 px-3 py-1 text-xs font-semibold text-purple-700 dark:text-purple-400"><Zap className="h-3 w-3" /> Antecipado</span>}
            </div>
          </div>
        </div>
        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {isEditable && canEdit && !editing && (
            <button type="button" onClick={startEditing} className="flex items-center gap-2 px-4 py-2.5 text-sm border border-blue-200 dark:border-blue-800 rounded-xl text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 font-medium transition-colors">
              <Pencil className="h-4 w-4" /> Editar
            </button>
          )}
          {editing && (
            <>
              <button type="button" onClick={() => setEditing(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium transition-colors">
                <Undo2 className="h-4 w-4" /> Cancelar
              </button>
              <button type="button" onClick={saveEdit} disabled={saving} className="flex items-center gap-2 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
              </button>
            </>
          )}
          {isEditable && !editing && (
            <button type="button" onClick={() => setShowBaixa(true)} className="flex items-center gap-2 px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium shadow-sm transition-colors">
              <CheckCircle className="h-4 w-4" /> Receber
            </button>
          )}
          {isEditable && !editing && otherPending.length > 0 && (
            <button type="button" onClick={() => setShowUnificar(true)} className="flex items-center gap-2 px-4 py-2.5 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium shadow-sm transition-colors">
              <Combine className="h-4 w-4" /> Unificar
            </button>
          )}
          {isAdmin && !editing && (
            <button type="button" title="Excluir" onClick={() => setShowDelete(true)} className="flex items-center px-3 py-2.5 text-sm border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ─── Value Card ──────────────────────── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <div className="flex items-end justify-between mb-4">
          <div>
            {editing ? (
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Descricao</label>
                <input type="text" title="Descricao" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className="block mt-1 text-xl font-bold w-full bg-transparent border-b-2 border-blue-300 dark:border-blue-700 text-gray-900 dark:text-white focus:border-blue-500 outline-none pb-1" />
              </div>
            ) : (
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{conta.description}</h1>
            )}
            {conta.service_orders && (
              <Link href={`/os/${conta.service_orders.id}`} className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline mt-1">
                OS-{String(conta.service_orders.os_number).padStart(4, '0')} <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
          <div className="text-right">
            {editing ? (
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Valor (R$)</label>
                <input type="number" step="0.01" min="0" title="Valor total" value={editForm.total_amount}
                  onChange={e => setEditForm(f => ({ ...f, total_amount: e.target.value }))}
                  className="block mt-1 text-2xl font-bold text-right w-40 bg-transparent border-b-2 border-blue-300 dark:border-blue-700 text-gray-900 dark:text-white focus:border-blue-500 outline-none pb-1" />
              </div>
            ) : (
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{fmt(conta.total_amount)}</p>
            )}
            {!editing && (conta.received_amount || 0) > 0 && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">Recebido: {fmt(conta.received_amount || 0)}</p>
            )}
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all duration-500', isPaid ? 'bg-emerald-500' : pctPaid > 0 ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700')}
            style={{ width: `${Math.min(pctPaid, 100)}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
          <span>{pctPaid.toFixed(0)}% recebido</span>
          {remaining > 0 && <span className="font-medium">Restante: {fmt(remaining)}</span>}
        </div>
      </div>

      {/* ─── Info Section ────────────────────── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm divide-y divide-gray-100 dark:divide-gray-800">
        {/* Cliente */}
        <div className="p-5">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <User className="h-3.5 w-3.5" /> Cliente
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{conta.customers?.legal_name || '—'}</p>
              {conta.customers?.document_number && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{conta.customers.document_number}</p>}
            </div>
          </div>
        </div>

        {/* Vencimento + Categoria */}
        <div className="p-5 grid grid-cols-2 gap-6">
          <div>
            <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              <Calendar className="h-3.5 w-3.5" /> Vencimento
            </h3>
            {editing ? (
              <input type="date" title="Vencimento" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white w-full" />
            ) : (
              <p className={cn('text-sm font-medium', isOverdue ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white')}>{safeDate(conta.due_date, true)}</p>
            )}
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              <Tag className="h-3.5 w-3.5" /> Categoria
            </h3>
            {editing ? (
              <select title="Categoria" value={editForm.category_id} onChange={e => setEditForm(f => ({ ...f, category_id: e.target.value }))}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white w-full">
                <option value="">Sem categoria</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <p className="text-sm font-medium text-gray-900 dark:text-white">{conta.categories?.name || '—'}</p>
            )}
          </div>
        </div>

        {/* Forma de Pagamento — Visual selector */}
        <div className="p-5">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <CreditCard className="h-3.5 w-3.5" /> Forma de Pagamento
          </h3>
          {editing ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PAYMENT_METHODS.map(pm => {
                const Icon = pm.icon
                const selected = editForm.payment_method === pm.value
                return (
                  <button key={pm.value} type="button"
                    onClick={() => setEditForm(f => ({ ...f, payment_method: f.payment_method === pm.value ? '' : pm.value }))}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all',
                      selected ? `${pm.color} ring-2 ring-offset-1 ring-current` : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                    )}>
                    <Icon className="h-4 w-4" /> {pm.label}
                  </button>
                )
              })}
            </div>
          ) : currentPM ? (
            <div className={cn('inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium', currentPM.color)}>
              <currentPM.icon className="h-4 w-4" /> {currentPM.label}
            </div>
          ) : (
            <p className="text-sm text-gray-400">{conta.payment_method || '—'}</p>
          )}
        </div>

        {/* Banco */}
        <div className="p-5">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <Building2 className="h-3.5 w-3.5" /> Contas Bancarias
          </h3>
          {accounts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center gap-2 rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2">
                  <div className="h-7 w-7 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white">
                    {(acc.bank_name || acc.name).substring(0, 2).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{acc.bank_name || acc.name}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">Nenhuma conta</p>}
        </div>

        {/* Observacoes */}
        <div className="p-5">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            <ClipboardList className="h-3.5 w-3.5" /> Observacoes
          </h3>
          {editing ? (
            <textarea rows={3} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Observacoes internas..."
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none" />
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{conta.notes || <span className="text-gray-400">Nenhuma observacao</span>}</p>
          )}
        </div>

        {/* Info extra */}
        <div className="p-5 flex flex-wrap gap-x-8 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
          <span>Criada em: {safeDate(conta.created_at)}</span>
          {conta.installment_count && conta.installment_count > 1 && <span>Parcelas: {conta.installment_count}x</span>}
        </div>
      </div>

      {/* ─── Grouped Items ────────────────────── */}
      {isGroupParent && groupedItems.length > 0 && (
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider mb-3">
            <Combine className="h-3.5 w-3.5" /> Contas Agrupadas ({groupedItems.length})
          </h3>
          <div className="space-y-2">
            {groupedItems.map(gi => (
              <div key={gi.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-xl p-3 border border-indigo-100 dark:border-indigo-900">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{gi.description}</p>
                  {gi.service_orders && <Link href={`/os/${gi.service_orders.id}`} className="text-xs text-blue-600 hover:underline">OS-{String(gi.service_orders.os_number).padStart(4, '0')}</Link>}
                </div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{fmt(gi.total_amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Boleto/CNAB — só mostra para boleto ou quando já tem boleto gerado */}
      {(conta.boleto_url || (conta.status === 'PENDENTE' && (!conta.payment_method || conta.payment_method.toLowerCase().includes('boleto')))) && (
        <div className={cn('rounded-2xl border p-5 shadow-sm', conta.boleto_url ? 'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/30' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900')}>
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <FileText className="h-3.5 w-3.5 text-orange-600" /> Boleto / CNAB
          </h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleReenviarRemessa} disabled={reenvioLoading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50">
              {reenvioLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : conta.boleto_url ? <RefreshCw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
              {conta.boleto_url ? 'Reenviar Remessa' : 'Gerar Remessa'}
            </button>
            {conta.boleto_url && (
              <button type="button" onClick={() => window.open(`/boleto-print?ids=${conta.id}`, '_blank')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gray-800 dark:bg-gray-700 px-3 py-2 text-xs font-medium text-white hover:bg-gray-900">
                <Printer className="h-3.5 w-3.5" /> Imprimir
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Asaas ────────────────────────────── */}
      {(conta.charge_id || conta.charge_url) && (
        <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30 p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider mb-3">
            <Banknote className="h-3.5 w-3.5" /> Cobranca Asaas
          </h3>
          {conta.charge_status && <p className="text-sm mb-2"><span className="text-gray-500">Status:</span> <span className="font-medium">{conta.charge_status}</span></p>}
          {conta.charge_url && (
            <a href={conta.charge_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium">
              Abrir link de pagamento <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {/* ─── Installments ─────────────────────── */}
      {installments.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <Hash className="h-3.5 w-3.5" /> Parcelas ({installments.length})
          </h3>
          <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 dark:bg-gray-800/50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-2.5">#</th><th className="px-4 py-2.5">Valor</th><th className="px-4 py-2.5">Vencimento</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Pago em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {installments.map(inst => {
                  const isc = statusConfig[inst.status] || statusConfig.PENDENTE
                  return (
                    <tr key={inst.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-2.5 font-medium">{inst.installment_number}</td>
                      <td className="px-4 py-2.5">{fmt(inst.amount)}</td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{safeDate(inst.due_date, true)}</td>
                      <td className="px-4 py-2.5"><span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', isc.bg, isc.text)}><span className={cn('h-1.5 w-1.5 rounded-full', isc.dot)} /> {isc.label}</span></td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{safeDate(inst.paid_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ MODALS ═══════════════════════════════ */}

      {/* Unificar */}
      {showUnificar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowUnificar(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2"><Combine className="h-5 w-5 text-indigo-600" /> Unificar Contas</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Selecione contas pendentes de <strong>{conta.customers?.legal_name}</strong></p>
            <div className="rounded-xl border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 p-3 mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><CheckSquare className="h-4 w-4 text-indigo-600" /><p className="text-sm font-medium">{conta.description}</p></div>
                <span className="text-sm font-bold">{fmt(conta.total_amount)}</span>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              {otherPending.map(item => (
                <button key={item.id} type="button" onClick={() => setSelectedIds(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })}
                  className={cn('w-full text-left rounded-xl border p-3 transition-all', selectedIds.has(item.id) ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300')}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {selectedIds.has(item.id) ? <CheckSquare className="h-4 w-4 text-indigo-600" /> : <Square className="h-4 w-4 text-gray-400" />}
                      <div>
                        <p className="text-sm font-medium">{item.description}</p>
                        <p className="text-xs text-gray-500">Venc: {safeDate(item.due_date, true)}</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold">{fmt(item.total_amount)}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-4 mb-4">
              <div className="flex justify-between text-sm border-t-0"><span className="text-gray-600">Contas</span><span className="font-medium">{selectedIds.size + 1}</span></div>
              <div className="flex justify-between text-sm border-t border-gray-200 dark:border-gray-700 pt-2 mt-2"><span className="font-semibold">Total</span><span className="font-bold text-lg text-indigo-700 dark:text-indigo-400">{fmt(selectedTotal)}</span></div>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowUnificar(false)} className="px-4 py-2.5 text-sm border rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button type="button" onClick={handleUnificar} disabled={selectedIds.size === 0 || unificando}
                className="px-4 py-2.5 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 font-medium">
                {unificando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Unificar {selectedIds.size + 1} contas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Baixa */}
      {showBaixa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowBaixa(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-600" /> Registrar Recebimento</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor (R$)</label>
                <input type="number" title="Valor" step="0.01" min="0" value={baixaAmount} onChange={e => setBaixaAmount(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data</label>
                <input type="date" title="Data recebimento" value={baixaDate} onChange={e => setBaixaDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl text-gray-900 dark:text-white" />
              </div>
              {accounts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Conta Bancaria</label>
                  <select title="Conta bancaria" value={baixaAccountId} onChange={e => setBaixaAccountId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl text-gray-900 dark:text-white">
                    <option value="">Selecione...</option>
                    {accounts.map(c => <option key={c.id} value={c.id}>{c.bank_name ? `${c.bank_name} — ${c.name}` : c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowBaixa(false)} className="px-4 py-2.5 text-sm border rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button type="button" onClick={handleBaixa} disabled={baixaSaving}
                className="px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 font-medium">
                {baixaSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-2">Excluir?</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Excluir <strong>{conta.description}</strong>?</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowDelete(false)} className="px-4 py-2.5 text-sm border rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting} className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
