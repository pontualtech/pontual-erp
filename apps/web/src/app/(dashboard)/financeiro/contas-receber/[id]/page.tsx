'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft, DollarSign, Loader2, Trash2, CheckCircle, Pencil, Zap, FileText,
  Download, Printer, RefreshCw, Building2, CreditCard, User, Calendar, Hash,
  ClipboardList, Combine, ExternalLink, CheckSquare, Square, AlertTriangle,
  Banknote, Receipt
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
  created_at: string; categories: { id: string; name: string } | null
  customers: { id: string; legal_name: string; document_number?: string } | null
  service_orders: { id: string; os_number: number } | null
}

interface Installment {
  id: string; installment_number: number; amount: number; due_date: string
  status: string; paid_at: string | null
}

interface BankAccount { id: string; name: string; bank_name: string | null }

interface OtherPending {
  id: string; description: string; total_amount: number; due_date: string
  payment_method: string | null
  service_orders: { id: string; os_number: number } | null
}

interface GroupedItem {
  id: string; description: string; total_amount: number; due_date: string
  service_orders: { id: string; os_number: number } | null
}

interface AnticipationInstallment {
  number: number; amount: number; due_date: string
  days_remaining: number; fee: number; net_amount: number
}

interface AnticipationPreview {
  installments: AnticipationInstallment[]; total_amount: number
  total_fee: number; anticipated_amount: number; fee_pct_per_day: number
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
  const { isAdmin } = useAuth()
  const [conta, setConta] = useState<ContaReceber | null>(null)
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [otherPending, setOtherPending] = useState<OtherPending[]>([])
  const [groupedItems, setGroupedItems] = useState<GroupedItem[]>([])
  const [installments, setInstallments] = useState<Installment[]>([])
  const [installmentsLoading, setInstallmentsLoading] = useState(true)

  // Modals
  const [showBaixa, setShowBaixa] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showUnificar, setShowUnificar] = useState(false)
  const [showAntecipar, setShowAntecipar] = useState(false)

  // Baixa state
  const [baixaAmount, setBaixaAmount] = useState('')
  const [baixaDate, setBaixaDate] = useState(new Date().toISOString().split('T')[0])
  const [baixaAccountId, setBaixaAccountId] = useState('')
  const [baixaSaving, setBaixaSaving] = useState(false)

  // Delete state
  const [deleting, setDeleting] = useState(false)

  // Unificar state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [unificando, setUnificando] = useState(false)

  // Anticipation state
  const [antecipPreview, setAntecipPreview] = useState<AnticipationPreview | null>(null)
  const [antecipLoading, setAntecipLoading] = useState(false)
  const [antecipConfirming, setAntecipConfirming] = useState(false)

  // Reenvio state
  const [reenvioLoading, setReenvioLoading] = useState(false)

  // ─── Load data ─────────────────────────────
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
        setInstallmentsLoading(false)
      })
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadConta() }, [id])

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
      setShowBaixa(false)
      loadConta()
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
      if (!res.ok) throw new Error(d.error || 'Erro ao unificar')
      toast.success(`${allIds.length} contas unificadas com sucesso!`)
      // Redirect to the new grouped receivable
      router.push(`/financeiro/contas-receber/${d.data.id}`)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro ao unificar') }
    finally { setUnificando(false) }
  }

  function toggleSelect(itemId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(itemId) ? next.delete(itemId) : next.add(itemId)
      return next
    })
  }

  function getBoletoMeta(): any {
    if (!conta?.pix_code) return null
    try { return JSON.parse(conta.pix_code) } catch { return null }
  }

  async function handleReenviarRemessa() {
    if (!conta) return
    setReenvioLoading(true)
    try {
      const res = await fetch(`/api/financeiro/cnab?ids=${conta.id}`)
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Erro ao gerar remessa') }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'remessa.rem'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Arquivo de remessa gerado!')
      loadConta()
    } catch (err: any) { toast.error(err.message || 'Erro ao gerar remessa') }
    finally { setReenvioLoading(false) }
  }

  function canAnticipate(): boolean {
    if (!conta || !isAdmin) return false
    if (conta.status !== 'PENDENTE' && conta.status !== 'VENCIDO') return false
    if (conta.anticipated_at) return false
    if (!conta.payment_method) return false
    const pm = conta.payment_method.toLowerCase()
    if (!pm.includes('cartão') && !pm.includes('cartao') && !pm.includes('credito') && !pm.includes('crédito')) return false
    if (!conta.installment_count || conta.installment_count <= 1) return false
    return true
  }

  async function openAntecipar() {
    setShowAntecipar(true); setAntecipPreview(null); setAntecipLoading(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${id}/antecipar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro ao carregar preview')
      setAntecipPreview(d.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
      setShowAntecipar(false)
    } finally { setAntecipLoading(false) }
  }

  async function handleAntecipar() {
    setAntecipConfirming(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${id}/antecipar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Antecipacao realizada!')
      setShowAntecipar(false); setAntecipPreview(null)
      loadConta()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setAntecipConfirming(false) }
  }

  // ─── Loading / Error states ────────────────
  if (loading) return (
    <div className="flex items-center justify-center py-20 gap-2 text-gray-400 dark:text-gray-500">
      <Loader2 className="h-5 w-5 animate-spin" /> Carregando...
    </div>
  )
  if (!conta) return <div className="py-20 text-center text-red-500">Conta nao encontrada</div>

  const remaining = conta.total_amount - (conta.received_amount || 0)
  const pctPaid = conta.total_amount > 0 ? ((conta.received_amount || 0) / conta.total_amount) * 100 : 0
  const isPaid = conta.status === 'RECEBIDO' || conta.status === 'PAGO'
  const isGroupParent = conta.group_id && !conta.grouped_into_id
  const sc = statusConfig[conta.status] || statusConfig.PENDENTE
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dueDay = new Date(conta.due_date + 'T00:00:00')
  const isOverdue = conta.status === 'PENDENTE' && dueDay < today
  const effectiveSc = isOverdue ? statusConfig.VENCIDO : sc

  const selectedTotal = Array.from(selectedIds).reduce((sum, sid) => {
    const item = otherPending.find(p => p.id === sid)
    return sum + (item?.total_amount || 0)
  }, 0) + conta.total_amount

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ─── Header ────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/financeiro/contas-receber" className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-500" />
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', effectiveSc.bg, effectiveSc.text)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', effectiveSc.dot)} />
                {isOverdue ? 'Vencido' : effectiveSc.label}
              </span>
              {conta.anticipated_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 dark:bg-purple-950 px-3 py-1 text-xs font-semibold text-purple-700 dark:text-purple-400">
                  <Zap className="h-3 w-3" /> Antecipado
                </span>
              )}
              {isGroupParent && (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 px-3 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-400">
                  <Combine className="h-3 w-3" /> Agrupamento
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{conta.description}</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isPaid && conta.status !== 'CANCELADO' && conta.status !== 'AGRUPADO' && (
            <button type="button" onClick={() => setShowBaixa(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-medium shadow-sm transition-colors">
              <CheckCircle className="h-4 w-4" /> Registrar Recebimento
            </button>
          )}
          {!isPaid && otherPending.length > 0 && (
            <button type="button" onClick={() => setShowUnificar(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium shadow-sm transition-colors">
              <Combine className="h-4 w-4" /> Unificar Contas
            </button>
          )}
          {canAnticipate() && (
            <button type="button" onClick={openAntecipar}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium shadow-sm transition-colors">
              <Zap className="h-4 w-4" /> Antecipar
            </button>
          )}
          {isAdmin && !isPaid && conta.status !== 'AGRUPADO' && (
            <button type="button" onClick={() => router.push(`/financeiro/contas-receber/${id}/editar`)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium transition-colors">
              <Pencil className="h-4 w-4" /> Editar
            </button>
          )}
          {isAdmin && (
            <button type="button" title="Excluir" onClick={() => setShowDelete(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm border border-red-200 dark:border-red-800 rounded-xl hover:bg-red-50 dark:hover:bg-red-950 text-red-600 dark:text-red-400 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ─── Value highlight + Progress ────────── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Valor Total</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">{fmt(conta.total_amount)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-500 dark:text-gray-400">Recebido</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{fmt(conta.received_amount || 0)}</p>
          </div>
        </div>
        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all duration-500', isPaid ? 'bg-emerald-500' : 'bg-blue-500')}
            style={{ width: `${Math.min(pctPaid, 100)}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-sm">
          <span className="text-gray-500 dark:text-gray-400">{pctPaid.toFixed(0)}% recebido</span>
          {remaining > 0 && <span className="font-medium text-gray-700 dark:text-gray-300">Restante: {fmt(remaining)}</span>}
        </div>
      </div>

      {/* ─── Info Cards Grid ──────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Cliente */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            <User className="h-4 w-4" /> Cliente
          </h2>
          <div className="space-y-3">
            <InfoRow label="Nome" value={conta.customers?.legal_name || '—'} />
            {conta.customers?.document_number && <InfoRow label="CPF/CNPJ" value={conta.customers.document_number} />}
            {conta.service_orders && (
              <div className="flex justify-between text-sm items-center">
                <span className="text-gray-500 dark:text-gray-400">OS Vinculada</span>
                <Link href={`/os/${conta.service_orders.id}`}
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium">
                  OS-{String(conta.service_orders.os_number).padStart(4, '0')}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Detalhes Financeiros */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            <Receipt className="h-4 w-4" /> Detalhes
          </h2>
          <div className="space-y-3">
            <InfoRow label="Categoria" value={conta.categories?.name || '—'} />
            <div className="flex justify-between text-sm items-center">
              <span className="text-gray-500 dark:text-gray-400">Forma Pagamento</span>
              {conta.payment_method ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  <CreditCard className="h-3 w-3" /> {conta.payment_method}
                </span>
              ) : <span className="text-gray-900 dark:text-white font-medium">—</span>}
            </div>
            {conta.installment_count && conta.installment_count > 1 && (
              <InfoRow label="Parcelas" value={`${conta.installment_count}x de ${fmt(Math.round(conta.total_amount / conta.installment_count))}`} />
            )}
            <InfoRow label="Vencimento" value={safeDate(conta.due_date, true)} highlight={isOverdue} />
          </div>
        </div>

        {/* Banco */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            <Building2 className="h-4 w-4" /> Conta Bancaria
          </h2>
          {accounts.length > 0 ? (
            <div className="space-y-3">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
                  <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
                    {(acc.bank_name || acc.name).substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{acc.bank_name || acc.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{acc.name}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma conta cadastrada</p>
          )}
          <div className="mt-3 space-y-3">
            <InfoRow label="Cadastrada em" value={safeDate(conta.created_at)} />
          </div>
        </div>
      </div>

      {/* ─── Grouped Items (if group parent) ──── */}
      {isGroupParent && groupedItems.length > 0 && (
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider mb-4">
            <Combine className="h-4 w-4" /> Contas Agrupadas ({groupedItems.length})
          </h2>
          <div className="space-y-2">
            {groupedItems.map(gi => (
              <div key={gi.id} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-xl p-3 border border-indigo-100 dark:border-indigo-900">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{gi.description}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {gi.service_orders && (
                      <Link href={`/os/${gi.service_orders.id}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        OS-{String(gi.service_orders.os_number).padStart(4, '0')}
                      </Link>
                    )}
                    <span className="text-xs text-gray-500 dark:text-gray-400">Venc: {safeDate(gi.due_date, true)}</span>
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{fmt(gi.total_amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Boleto / CNAB ────────────────────── */}
      {(() => {
        const meta = getBoletoMeta()
        const hasBoleto = !!conta.boleto_url
        return (
          <div className={cn('rounded-2xl border p-5 shadow-sm', hasBoleto ? 'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/30' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900')}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <FileText className="h-4 w-4 text-orange-600 dark:text-orange-400" /> Boleto / Remessa CNAB
              </h2>
              {hasBoleto && (
                <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full',
                  meta?.boletoStatus === 'PAID' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400' :
                  meta?.boletoStatus === 'REJECTED' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-400' :
                  'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-400'
                )}>
                  {meta?.boletoStatus === 'PAID' ? 'Pago' : meta?.boletoStatus === 'REJECTED' ? 'Rejeitado' : 'Processando'}
                </span>
              )}
            </div>
            {hasBoleto ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow label="Banco" value="Banco Inter (077)" />
                  <InfoRow label="Metodo" value={conta.boleto_url?.startsWith('cnab://') ? 'CNAB 400' : 'API'} />
                  {meta?.nossoNumero && <InfoRow label="Nosso numero" value={meta.nossoNumero} />}
                  {meta?.valorPago && <InfoRow label="Valor pago" value={fmt(meta.valorPago)} />}
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button type="button" onClick={handleReenviarRemessa} disabled={reenvioLoading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50 transition-colors">
                    {reenvioLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Reenviar Remessa
                  </button>
                  <button type="button" onClick={() => window.open(`/boleto-print?ids=${conta.id}`, '_blank')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gray-800 dark:bg-gray-700 px-3 py-2 text-xs font-medium text-white hover:bg-gray-900 dark:hover:bg-gray-600 transition-colors">
                    <Printer className="h-3.5 w-3.5" /> Imprimir
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum boleto gerado.</p>
                {conta.status === 'PENDENTE' && (
                  <button type="button" onClick={handleReenviarRemessa} disabled={reenvioLoading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50 transition-colors">
                    {reenvioLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Gerar Remessa CNAB
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ─── Charge (Asaas) ───────────────────── */}
      {(conta.charge_id || conta.charge_url) && (
        <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider mb-4">
            <Banknote className="h-4 w-4" /> Cobranca Asaas
          </h2>
          <div className="space-y-3">
            {conta.charge_status && <InfoRow label="Status" value={conta.charge_status} />}
            {conta.charge_url && (
              <div className="flex justify-between text-sm items-center">
                <span className="text-gray-500 dark:text-gray-400">Link Pagamento</span>
                <a href={conta.charge_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium text-xs">
                  Abrir <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Notes ────────────────────────────── */}
      {conta.notes && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            <ClipboardList className="h-4 w-4" /> Observacoes
          </h2>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{conta.notes}</p>
        </div>
      )}

      {/* ─── Anticipation ─────────────────────── */}
      {conta.anticipated_at && (
        <div className="rounded-2xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/30 p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wider mb-4">
            <Zap className="h-4 w-4" /> Antecipacao
          </h2>
          <div className="space-y-3">
            <InfoRow label="Antecipado em" value={safeDate(conta.anticipated_at)} />
            {conta.anticipation_fee != null && <InfoRow label="Taxa" value={`-${fmt(conta.anticipation_fee)}`} />}
            {conta.anticipated_amount != null && <InfoRow label="Valor antecipado" value={fmt(conta.anticipated_amount)} />}
          </div>
        </div>
      )}

      {/* ─── Installments ─────────────────────── */}
      {(installments.length > 0 || installmentsLoading) && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <Hash className="h-4 w-4" /> Parcelas
            </h2>
          </div>
          {installmentsLoading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-gray-400 dark:text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-2.5">#</th>
                    <th className="px-4 py-2.5">Valor</th>
                    <th className="px-4 py-2.5">Vencimento</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Pago em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {installments.map(inst => {
                    const instSc = statusConfig[inst.status] || statusConfig.PENDENTE
                    return (
                      <tr key={inst.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{inst.installment_number}</td>
                        <td className="px-4 py-2.5 text-gray-900 dark:text-white">{fmt(inst.amount)}</td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{safeDate(inst.due_date, true)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', instSc.bg, instSc.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', instSc.dot)} /> {instSc.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{safeDate(inst.paid_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ MODALS ═══════════════════════════════ */}

      {/* ─── Unificar Modal ───────────────────── */}
      {showUnificar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowUnificar(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
              <Combine className="h-5 w-5 text-indigo-600" /> Unificar Contas a Receber
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Selecione as contas pendentes de <strong>{conta.customers?.legal_name}</strong> para pagar tudo junto.
            </p>

            {/* Current conta (always included) */}
            <div className="rounded-xl border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 p-3 mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-4 w-4 text-indigo-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{conta.description}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Venc: {safeDate(conta.due_date, true)}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white">{fmt(conta.total_amount)}</span>
              </div>
            </div>

            {/* Other pending */}
            <div className="space-y-2 mb-4">
              {otherPending.map(item => (
                <button key={item.id} type="button" onClick={() => toggleSelect(item.id)}
                  className={cn(
                    'w-full text-left rounded-xl border p-3 transition-all',
                    selectedIds.has(item.id)
                      ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-950/30'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {selectedIds.has(item.id) ? <CheckSquare className="h-4 w-4 text-indigo-600" /> : <Square className="h-4 w-4 text-gray-400" />}
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{item.description}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-gray-500 dark:text-gray-400">Venc: {safeDate(item.due_date, true)}</p>
                          {item.service_orders && (
                            <span className="text-xs text-blue-600 dark:text-blue-400">OS-{String(item.service_orders.os_number).padStart(4, '0')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">{fmt(item.total_amount)}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Summary */}
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-4 mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600 dark:text-gray-400">Contas selecionadas</span>
                <span className="font-medium text-gray-900 dark:text-white">{selectedIds.size + 1}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                <span className="font-semibold text-gray-900 dark:text-white">Total Unificado</span>
                <span className="font-bold text-lg text-indigo-700 dark:text-indigo-400">{fmt(selectedTotal)}</span>
              </div>
            </div>

            {selectedIds.size === 0 && (
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm mb-4">
                <AlertTriangle className="h-4 w-4" /> Selecione pelo menos uma conta adicional
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowUnificar(false)}
                className="px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors">Cancelar</button>
              <button type="button" onClick={handleUnificar} disabled={selectedIds.size === 0 || unificando}
                className="px-4 py-2.5 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 font-medium transition-colors">
                {unificando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {unificando ? 'Unificando...' : `Unificar ${selectedIds.size + 1} contas`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Baixa Modal ──────────────────────── */}
      {showBaixa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowBaixa(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
              <DollarSign className="h-5 w-5 text-emerald-600" /> Registrar Recebimento
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor (R$)</label>
                <input type="number" title="Valor do recebimento" step="0.01" min="0" value={baixaAmount} onChange={e => setBaixaAmount(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data do Recebimento</label>
                <input type="date" title="Data do recebimento" value={baixaDate} onChange={e => setBaixaDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-800" />
              </div>
              {accounts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Conta Bancaria</label>
                  <select title="Conta bancária" value={baixaAccountId} onChange={e => setBaixaAccountId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl">
                    <option value="">Selecione...</option>
                    {accounts.map(c => <option key={c.id} value={c.id}>{c.bank_name ? `${c.bank_name} — ${c.name}` : c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowBaixa(false)}
                className="px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors">Cancelar</button>
              <button type="button" onClick={handleBaixa} disabled={baixaSaving}
                className="px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 font-medium transition-colors">
                {baixaSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {baixaSaving ? 'Registrando...' : 'Confirmar Recebimento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Modal ─────────────────────── */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-2 text-gray-900 dark:text-white">Excluir conta a receber?</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Tem certeza que deseja excluir <strong>{conta.description}</strong>?</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowDelete(false)}
                className="px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2.5 text-sm bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium transition-colors">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Anticipation Modal ───────────────── */}
      {showAntecipar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setShowAntecipar(false); setAntecipPreview(null) }}>
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
              <Zap className="h-5 w-5 text-purple-600" /> Antecipar Recebiveis
            </h2>
            {antecipLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /> Calculando...</div>
            ) : antecipPreview ? (
              <>
                <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800 mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 dark:bg-gray-800/50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        <th className="px-3 py-2">#</th><th className="px-3 py-2">Valor</th><th className="px-3 py-2">Vencimento</th>
                        <th className="px-3 py-2 text-right">Dias</th><th className="px-3 py-2 text-right">Taxa</th><th className="px-3 py-2 text-right">Liquido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                      {antecipPreview.installments.map(inst => (
                        <tr key={inst.number}>
                          <td className="px-3 py-2 font-medium">{inst.number}</td>
                          <td className="px-3 py-2">{fmt(inst.amount)}</td>
                          <td className="px-3 py-2">{safeDate(inst.due_date, true)}</td>
                          <td className="px-3 py-2 text-right">{inst.days_remaining}</td>
                          <td className="px-3 py-2 text-right text-red-600 dark:text-red-400">-{fmt(inst.fee)}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmt(inst.net_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 rounded-xl bg-gray-50 dark:bg-gray-800 p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Valor total</span>
                    <span className="font-medium">{fmt(antecipPreview.total_amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Taxa ({antecipPreview.fee_pct_per_day}%/dia)</span>
                    <span className="font-medium text-red-600 dark:text-red-400">-{fmt(antecipPreview.total_fee)}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-gray-200 dark:border-gray-700 pt-2">
                    <span className="font-semibold text-gray-900 dark:text-white">Valor a receber</span>
                    <span className="font-bold text-green-600 dark:text-green-400 text-base">{fmt(antecipPreview.anticipated_amount)}</span>
                  </div>
                </div>
                <div className="flex gap-3 justify-end mt-5">
                  <button type="button" onClick={() => { setShowAntecipar(false); setAntecipPreview(null) }}
                    className="px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors">Cancelar</button>
                  <button type="button" onClick={handleAntecipar} disabled={antecipConfirming}
                    className="px-4 py-2.5 text-sm bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 font-medium transition-colors">
                    {antecipConfirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {antecipConfirming ? 'Antecipando...' : 'Confirmar Antecipacao'}
                  </button>
                </div>
              </>
            ) : <p className="text-sm text-red-500 py-4">Erro ao carregar preview.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Reusable Row ────────────────────────────
function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between text-sm items-center">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={cn('font-medium', highlight ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white')}>{value}</span>
    </div>
  )
}
