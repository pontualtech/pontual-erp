'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft, Loader2, Trash2, CheckCircle, Pencil, Save, Undo2,
  Building2, CreditCard, User, Calendar, DollarSign, Tag,
  ClipboardList, QrCode, FileBarChart, Landmark, Coins, Smartphone, Hash
} from 'lucide-react'
import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────
interface ContaPagar {
  id: string; description: string; total_amount: number; paid_amount: number
  due_date: string; status: string; payment_method: string | null; notes: string | null
  category_id: string | null; cost_center_id: string | null
  created_at: string
  categories: { id: string; name: string } | null
  cost_centers: { id: string; name: string } | null
  customers: { id: string; legal_name: string; document_number?: string } | null
}
interface BankAccount { id: string; name: string; bank_name: string | null }
interface CategoryItem { id: string; name: string }
interface CostCenterItem { id: string; name: string }
interface Installment {
  id: string; installment_number: number; amount: number; due_date: string
  status: string; paid_at: string | null
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
  PAGO: { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500', label: 'Pago' },
  CANCELADO: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', dot: 'bg-gray-400', label: 'Cancelado' },
}

// ─── Component ───────────────────────────────
export default function ContaPagarDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { isAdmin, hasPermission } = useAuth()
  const canEdit = isAdmin || hasPermission('financeiro', 'edit')

  const [conta, setConta] = useState<ContaPagar | null>(null)
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [costCenters, setCostCenters] = useState<CostCenterItem[]>([])
  const [installments, setInstallments] = useState<Installment[]>([])

  // Edit
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ description: '', total_amount: '', due_date: '', payment_method: '', category_id: '', cost_center_id: '', notes: '' })
  const [saving, setSaving] = useState(false)

  // Baixa
  const [showBaixa, setShowBaixa] = useState(false)
  const [baixaAmount, setBaixaAmount] = useState('')
  const [baixaDate, setBaixaDate] = useState(new Date().toISOString().split('T')[0])
  const [baixaAccountId, setBaixaAccountId] = useState('')
  const [baixaSaving, setBaixaSaving] = useState(false)

  // Delete
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ─── Load ──────────────────────────────────
  function loadConta() {
    fetch(`/api/financeiro/contas-pagar/${id}`).then(r => r.json())
      .then(d => {
        const c = d.data
        if (!c) { toast.error('Conta nao encontrada'); router.push('/financeiro/contas-pagar'); return }
        setConta(c)
        setBaixaAmount(String((c.total_amount - (c.paid_amount || 0)) / 100))
        setAccounts(d.data.accounts ?? [])
        setCostCenters(d.data.cost_centers ?? [])
        setInstallments(d.data.installments ?? [])
        setEditForm({
          description: c.description,
          total_amount: String((c.total_amount || 0) / 100),
          due_date: c.due_date ? new Date(c.due_date).toISOString().split('T')[0] : '',
          payment_method: c.payment_method || '',
          category_id: c.category_id || '',
          cost_center_id: c.cost_center_id || '',
          notes: c.notes || '',
        })
      })
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))

    // Also load categories separately (the API returns categories as relation, not list)
    fetch('/api/financeiro/categorias?limit=100').then(r => r.json())
      .then(d => setCategories(d.data ?? [])).catch(() => {})
  }

  useEffect(() => { loadConta() }, [id])

  // ─── Edit ──────────────────────────────────
  function startEditing() {
    if (!conta) return
    setEditForm({
      description: conta.description,
      total_amount: String((conta.total_amount || 0) / 100),
      due_date: conta.due_date ? new Date(conta.due_date).toISOString().split('T')[0] : '',
      payment_method: conta.payment_method || '',
      category_id: conta.category_id || '',
      cost_center_id: conta.cost_center_id || '',
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
        cost_center_id: editForm.cost_center_id || null,
      }
      const amt = Math.round(parseFloat(editForm.total_amount) * 100)
      if (isNaN(amt) || amt <= 0) { toast.error('Valor deve ser maior que zero'); setSaving(false); return }
      payload.total_amount = amt
      if (editForm.due_date) payload.due_date = editForm.due_date

      const res = await fetch(`/api/financeiro/contas-pagar/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Conta atualizada!')
      setEditing(false); loadConta()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  // ─── Baixa ─────────────────────────────────
  async function handleBaixa() {
    setBaixaSaving(true)
    try {
      const res = await fetch(`/api/financeiro/contas-pagar/${id}/baixa`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid_amount: Math.round(parseFloat(baixaAmount) * 100), paid_at: baixaDate, account_id: baixaAccountId || undefined }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Pagamento registrado!')
      setShowBaixa(false); loadConta()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setBaixaSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/contas-pagar/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Conta excluida'); router.push('/financeiro/contas-pagar')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  // ─── Render ────────────────────────────────
  if (loading) return <div className="flex items-center justify-center py-20 gap-2 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /> Carregando...</div>
  if (!conta) return <div className="py-20 text-center text-red-500">Conta nao encontrada</div>

  const remaining = conta.total_amount - (conta.paid_amount || 0)
  const pctPaid = conta.total_amount > 0 ? ((conta.paid_amount || 0) / conta.total_amount) * 100 : 0
  const isPaid = conta.status === 'PAGO'
  const isEditable = !isPaid && conta.status !== 'CANCELADO'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dueDay = new Date(String(conta.due_date).substring(0, 10) + 'T00:00:00')
  const isOverdue = conta.status === 'PENDENTE' && dueDay < today
  const sc = statusConfig[isOverdue ? 'VENCIDO' : conta.status] || statusConfig.PENDENTE
  const currentPM = PAYMENT_METHODS.find(p => p.value === (editing ? editForm.payment_method : conta.payment_method))

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* ─── Header ──────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro/contas-pagar" className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5 hover:bg-gray-50 dark:hover:bg-gray-800">
            <ArrowLeft className="h-4 w-4 text-gray-500" />
          </Link>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium">Conta a Pagar</p>
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold mt-0.5', sc.bg, sc.text)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', sc.dot)} />
              {isOverdue ? 'Vencido' : sc.label}
            </span>
          </div>
        </div>
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
              <CheckCircle className="h-4 w-4" /> Pagar
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
          </div>
          <div className="text-right">
            {editing ? (
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Valor (R$)</label>
                <input type="number" title="Valor total" step="0.01" min="0" value={editForm.total_amount}
                  onChange={e => setEditForm(f => ({ ...f, total_amount: e.target.value }))}
                  className="block mt-1 text-2xl font-bold text-right w-40 bg-transparent border-b-2 border-blue-300 dark:border-blue-700 text-gray-900 dark:text-white focus:border-blue-500 outline-none pb-1" />
              </div>
            ) : (
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{fmt(conta.total_amount)}</p>
            )}
            {!editing && (conta.paid_amount || 0) > 0 && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">Pago: {fmt(conta.paid_amount || 0)}</p>
            )}
          </div>
        </div>
        <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all duration-500', isPaid ? 'bg-emerald-500' : pctPaid > 0 ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700')}
            style={{ width: `${Math.min(pctPaid, 100)}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400">
          <span>{pctPaid.toFixed(0)}% pago</span>
          {remaining > 0 && <span className="font-medium">Restante: {fmt(remaining)}</span>}
        </div>
      </div>

      {/* ─── Info Section ────────────────────── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm divide-y divide-gray-100 dark:divide-gray-800">
        {/* Fornecedor */}
        <div className="p-5">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <User className="h-3.5 w-3.5" /> Fornecedor
          </h3>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{conta.customers?.legal_name || '—'}</p>
          {conta.customers?.document_number && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{conta.customers.document_number}</p>}
        </div>

        {/* Vencimento + Categoria + Centro Custo */}
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-6">
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
          <div>
            <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              <Building2 className="h-3.5 w-3.5" /> Centro de Custo
            </h3>
            {editing ? (
              <select title="Centro de Custo" value={editForm.cost_center_id} onChange={e => setEditForm(f => ({ ...f, cost_center_id: e.target.value }))}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white w-full">
                <option value="">Sem centro de custo</option>
                {costCenters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <p className="text-sm font-medium text-gray-900 dark:text-white">{conta.cost_centers?.name || '—'}</p>
            )}
          </div>
        </div>

        {/* Forma de Pagamento */}
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
        <div className="p-5 text-xs text-gray-500 dark:text-gray-400">
          Criada em: {safeDate(conta.created_at)}
        </div>
      </div>

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
                    <tr key={inst.id}>
                      <td className="px-4 py-2.5 font-medium">{inst.installment_number}</td>
                      <td className="px-4 py-2.5">{fmt(inst.amount)}</td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{safeDate(inst.due_date, true)}</td>
                      <td className="px-4 py-2.5"><span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', isc.bg, isc.text)}><span className={cn('h-1.5 w-1.5 rounded-full', isc.dot)} /> {isc.label}</span></td>
                      <td className="px-4 py-2.5 text-gray-500">{safeDate(inst.paid_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ MODALS ═══════════════════════════════ */}

      {/* Baixa */}
      {showBaixa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowBaixa(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-600" /> Registrar Pagamento</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor (R$)</label>
                <input type="number" title="Valor" step="0.01" min="0" value={baixaAmount} onChange={e => setBaixaAmount(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-xl text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data</label>
                <input type="date" title="Data pagamento" value={baixaDate} onChange={e => setBaixaDate(e.target.value)}
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
