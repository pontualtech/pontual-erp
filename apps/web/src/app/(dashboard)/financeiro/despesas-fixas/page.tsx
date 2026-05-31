'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, RefreshCw, Pause, Play, Calendar, Wallet, FolderTree, Loader2, TrendingDown, TrendingUp, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// Feature 2026-05-31 (Karlão): Submodulo Despesas Fixas.
// Lista cadastros + KPIs (total mensal/anual) + histórico 12m + form inline.

interface FixedExpense {
  id: string
  name: string
  amount_cents: number
  due_day: number
  category_id: string | null
  cost_center_id: string | null
  account_id: string | null
  payment_method: string | null
  notes: string | null
  active: boolean
  last_generated_at: string | null
  categories: { id: string; name: string } | null
  cost_centers: { id: string; name: string } | null
  stats12m: { count: number; paid_total: number }
}

interface Summary {
  total_active: number
  total_paused: number
  monthly_cents: number
  annual_cents: number
}

interface Account { id: string; name: string }
interface Category { id: string; name: string }
interface CostCenter { id: string; name: string }

function fmt(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function DespesasFixasPage() {
  const router = useRouter()
  const [items, setItems] = useState<FixedExpense[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showActiveOnly, setShowActiveOnly] = useState(false)

  // Lookups pra dropdowns do form
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])

  // Modal form (create/edit)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDueDay, setFormDueDay] = useState('5')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [formCostCenterId, setFormCostCenterId] = useState('')
  const [formAccountId, setFormAccountId] = useState('')
  const [formPaymentMethod, setFormPaymentMethod] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [runningNow, setRunningNow] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/financeiro/despesas-fixas?stats=1${showActiveOnly ? '&active=1' : ''}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.data?.items ?? [])
        setSummary(d.data?.summary ?? null)
      })
      .catch(() => toast.error('Erro ao carregar despesas fixas'))
      .finally(() => setLoading(false))
  }, [showActiveOnly])

  useEffect(() => {
    load()
    // Lookups (lazy não vale a pena — são pequenos)
    fetch('/api/financeiro/contas-bancarias').then((r) => r.json()).then((d) => setAccounts(d.data ?? [])).catch(() => {})
    fetch('/api/financeiro/categorias?limit=200').then((r) => r.json()).then((d) => setCategories(d.data ?? [])).catch(() => {})
    fetch('/api/financeiro/centros-custo?limit=100').then((r) => r.json()).then((d) => setCostCenters(d.data ?? [])).catch(() => {})
  }, [load])

  function openCreate() {
    setEditingId(null)
    setFormName(''); setFormAmount(''); setFormDueDay('5')
    setFormCategoryId(''); setFormCostCenterId(''); setFormPaymentMethod(''); setFormNotes('')
    setFormActive(true)
    // Default Itaú
    const itau = accounts.find((a) => /itau/i.test(a.name)) ?? accounts[0]
    setFormAccountId(itau?.id ?? '')
    setModalOpen(true)
  }

  function openEdit(fe: FixedExpense) {
    setEditingId(fe.id)
    setFormName(fe.name)
    setFormAmount((fe.amount_cents / 100).toFixed(2).replace('.', ','))
    setFormDueDay(String(fe.due_day))
    setFormCategoryId(fe.category_id ?? '')
    setFormCostCenterId(fe.cost_center_id ?? '')
    setFormAccountId(fe.account_id ?? '')
    setFormPaymentMethod(fe.payment_method ?? '')
    setFormNotes(fe.notes ?? '')
    setFormActive(fe.active)
    setModalOpen(true)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim()) { toast.error('Nome obrigatório'); return }
    const amountCents = Math.round(parseFloat(formAmount.replace(',', '.')) * 100) || 0
    if (amountCents <= 0) { toast.error('Valor deve ser maior que zero'); return }
    const dueDay = parseInt(formDueDay, 10)
    if (!dueDay || dueDay < 1 || dueDay > 31) { toast.error('Dia de vencimento deve ser 1-31'); return }
    if (!formAccountId) { toast.error('Selecione a conta bancária'); return }

    setSaving(true)
    try {
      const body = {
        name: formName.trim(),
        amount_cents: amountCents,
        due_day: dueDay,
        category_id: formCategoryId || null,
        cost_center_id: formCostCenterId || null,
        account_id: formAccountId || null,
        payment_method: formPaymentMethod || null,
        notes: formNotes || null,
        active: formActive,
      }
      const url = editingId
        ? `/api/financeiro/despesas-fixas/${editingId}`
        : '/api/financeiro/despesas-fixas'
      const r = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const j = await r.json()
        throw new Error(j.error || 'Erro')
      }
      toast.success(editingId ? 'Despesa fixa atualizada' : 'Despesa fixa criada')
      setModalOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  async function togglePause(fe: FixedExpense) {
    try {
      const r = await fetch(`/api/financeiro/despesas-fixas/${fe.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !fe.active }),
      })
      if (!r.ok) throw new Error()
      toast.success(fe.active ? 'Pausada' : 'Reativada')
      load()
    } catch {
      toast.error('Erro ao alterar status')
    }
  }

  async function doDelete() {
    if (!deleteId) return
    try {
      const r = await fetch(`/api/financeiro/despesas-fixas/${deleteId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      toast.success('Despesa fixa excluída')
      setDeleteId(null)
      load()
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  async function runNow() {
    if (runningNow) return
    if (!confirm('Gerar contas a pagar do mês corrente pras despesas fixas ativas?\n\nIdempotente: itens já gerados este mês são pulados.')) return
    setRunningNow(true)
    try {
      const r = await fetch('/api/financeiro/despesas-fixas/run-now', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || 'Erro')
      const { generated, skipped, failed, month } = d.data
      const parts = [`${generated} gerada(s)`]
      if (skipped) parts.push(`${skipped} já existia(m)`)
      if (failed) parts.push(`${failed} falhou`)
      toast.success(`${month}: ${parts.join(' · ')}`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao gerar APs')
    } finally {
      setRunningNow(false)
    }
  }

  // Donut: comparação despesas fixas (mensal) vs A pagar total (visual simples sem chart lib)
  // Cálculo aproximado: fixas / (fixas + média mensal de variáveis ao longo dos 12m).
  const variablePaidLast12mCents = useMemo(() => {
    return items.reduce((s, it) => s + it.stats12m.paid_total, 0)
  }, [items])
  const fixedSharePct = summary && summary.monthly_cents > 0 && variablePaidLast12mCents > 0
    ? Math.min(100, Math.round((summary.monthly_cents * 12) / (summary.monthly_cents * 12 + Math.max(0, variablePaidLast12mCents - summary.monthly_cents * 12)) * 100))
    : null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Financeiro</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-gray-900">Despesas fixas</h1>
          <p className="mt-1 text-xs text-gray-500">Templates que geram contas a pagar automaticamente todo mês</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/financeiro/contas-pagar"
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100"
          >
            <TrendingDown className="h-4 w-4" />
            Contas a pagar
          </Link>
          <button
            type="button"
            onClick={runNow}
            disabled={runningNow}
            title="Gera os contas a pagar do mês corrente agora (idempotente). O cron diário também faz isso automaticamente."
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-700 transition-colors hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runningNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Gerar APs do mês agora
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-gray-900 px-3 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            Nova despesa fixa
          </button>
        </div>
      </div>

      {/* Filters sticky */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowActiveOnly(!showActiveOnly)}
            className={cn(
              'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
              showActiveOnly ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
            )}
          >
            <Play className="h-3.5 w-3.5" />
            {showActiveOnly ? 'Só ativas' : 'Todas'}
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Stat
          label="Despesas ativas"
          value={loading ? '—' : String(summary?.total_active ?? 0)}
          sub={summary?.total_paused ? `${summary.total_paused} pausada(s)` : null}
          tone="blue"
        />
        <Stat
          label="Total mensal"
          value={loading ? '—' : fmt(summary?.monthly_cents ?? 0)}
          sub="Soma das ativas"
          tone="red"
        />
        <Stat
          label="Total anual projetado"
          value={loading ? '—' : fmt(summary?.annual_cents ?? 0)}
          sub="12 × mensal"
          tone="orange"
        />
        <Stat
          label="Fixo no total (12m)"
          value={loading || fixedSharePct === null ? '—' : `${fixedSharePct}%`}
          sub={fixedSharePct !== null ? 'do total pago' : 'sem histórico ainda'}
          tone="amber"
        />
      </div>

      {/* Lista */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
        <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">
          Cadastros {!loading && `(${items.length})`}
        </div>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-gray-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Carregando…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center">
            <Calendar className="h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">Nenhuma despesa fixa cadastrada</p>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800"
            >
              <Plus className="h-4 w-4" />
              Cadastrar primeira
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((fe) => (
              <div key={fe.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50', !fe.active && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-gray-900">{fe.name}</p>
                    {!fe.active && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">PAUSADA</span>}
                  </div>
                  <p className="text-xs text-gray-500">
                    Vence dia {fe.due_day}
                    {fe.categories && ` · ${fe.categories.name}`}
                    {fe.cost_centers && ` · ${fe.cost_centers.name}`}
                    {fe.payment_method && ` · ${fe.payment_method}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">{fmt(fe.amount_cents)}</p>
                  <p className="text-[11px] text-gray-500 tabular-nums">
                    {fe.stats12m.count > 0 ? `${fe.stats12m.count} pago(s) 12m` : 'sem histórico'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => togglePause(fe)}
                    title={fe.active ? 'Pausar' : 'Reativar'}
                    className={cn('rounded p-1.5 transition-colors hover:bg-gray-100', fe.active ? 'text-gray-500' : 'text-emerald-600')}
                  >
                    {fe.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(fe)}
                    title="Editar"
                    className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-amber-600"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(fe.id)}
                    title="Excluir"
                    className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal create/edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              {editingId ? 'Editar despesa fixa' : 'Nova despesa fixa'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Nome *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ex: Aluguel sede"
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fe-amount" className="mb-1 block text-xs font-medium text-gray-700">Valor (R$) *</label>
                  <input
                    id="fe-amount"
                    type="text"
                    inputMode="decimal"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0,00"
                    className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="fe-due-day" className="mb-1 block text-xs font-medium text-gray-700">Dia do vencimento *</label>
                  <input
                    id="fe-due-day"
                    type="number"
                    min="1"
                    max="31"
                    value={formDueDay}
                    onChange={(e) => setFormDueDay(e.target.value)}
                    placeholder="5"
                    className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="fe-account" className="mb-1 block text-xs font-medium text-gray-700">Conta bancária *</label>
                <select
                  id="fe-account"
                  value={formAccountId}
                  onChange={(e) => setFormAccountId(e.target.value)}
                  className="h-10 w-full cursor-pointer rounded-md border border-gray-200 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none"
                  required
                >
                  <option value="">Selecione…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fe-category" className="mb-1 block text-xs font-medium text-gray-700">Categoria</label>
                  <select
                    id="fe-category"
                    value={formCategoryId}
                    onChange={(e) => setFormCategoryId(e.target.value)}
                    className="h-10 w-full cursor-pointer rounded-md border border-gray-200 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Sem categoria</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="fe-cost-center" className="mb-1 block text-xs font-medium text-gray-700">Centro de custo</label>
                  <select
                    id="fe-cost-center"
                    value={formCostCenterId}
                    onChange={(e) => setFormCostCenterId(e.target.value)}
                    className="h-10 w-full cursor-pointer rounded-md border border-gray-200 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Sem centro</option>
                    {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="fe-payment-method" className="mb-1 block text-xs font-medium text-gray-700">Forma de pagamento</label>
                <input
                  id="fe-payment-method"
                  type="text"
                  value={formPaymentMethod}
                  onChange={(e) => setFormPaymentMethod(e.target.value)}
                  placeholder="ex: PIX, Boleto, DA"
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="fe-notes" className="mb-1 block text-xs font-medium text-gray-700">Notas</label>
                <textarea
                  id="fe-notes"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  rows={2}
                  placeholder="Opcional"
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                Ativa (cron gera AP do mês automaticamente)
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="inline-flex h-9 cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingId ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirma delete */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-gray-900">Excluir despesa fixa?</h2>
            <p className="mt-2 text-sm text-gray-500">
              O histórico de pagamentos passados será preservado, mas a despesa não gera mais APs novas.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                className="inline-flex h-9 cursor-pointer items-center rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={doDelete}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string | null; tone: 'red' | 'orange' | 'amber' | 'blue' }) {
  const tones = {
    red: 'text-red-600',
    orange: 'text-orange-600',
    amber: 'text-amber-600',
    blue: 'text-blue-700',
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgb(0,0,0,0.04)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  )
}
