'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, DollarSign, Loader2, Trash2, CheckCircle, Pencil, Zap } from 'lucide-react'
import { useAuth } from '@/lib/use-auth'

function safeDate(v: any, utc = false): string {
  if (!v) return '--'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('pt-BR', utc ? { timeZone: 'UTC' } : undefined)
}

interface ContaReceber {
  id: string; description: string; total_amount: number; received_amount: number
  due_date: string; status: string; payment_method: string | null; notes: string | null
  installment_count: number | null
  anticipated_at: string | null; anticipation_fee: number | null; anticipated_amount: number | null
  created_at: string; categories: { name: string } | null
  customers: { legal_name: string } | null
  service_orders: { id: string; os_number: number } | null
}

interface Installment {
  id: string; number: number; amount: number; due_date: string
  status: string; paid_at: string | null
}

interface AnticipationInstallment {
  number: number; amount: number; due_date: string
  days_remaining: number; fee: number; net_amount: number
}

interface AnticipationPreview {
  installments: AnticipationInstallment[]; total_amount: number
  total_fee: number; anticipated_amount: number; fee_pct_per_day: number
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

const statusColors: Record<string, string> = {
  PENDENTE: 'bg-blue-100 text-blue-700', VENCIDO: 'bg-red-100 text-red-700',
  RECEBIDO: 'bg-green-100 text-green-700', PAGO: 'bg-green-100 text-green-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
}

export default function ContaReceberDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { isAdmin } = useAuth()
  const [conta, setConta] = useState<ContaReceber | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBaixa, setShowBaixa] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [baixaAmount, setBaixaAmount] = useState('')
  const [baixaDate, setBaixaDate] = useState(new Date().toISOString().split('T')[0])
  const [baixaSaving, setBaixaSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [contas, setContas] = useState<{ id: string; name: string }[]>([])
  const [baixaAccountId, setBaixaAccountId] = useState('')
  const [installments, setInstallments] = useState<Installment[]>([])
  const [installmentsLoading, setInstallmentsLoading] = useState(true)
  const [showAntecipar, setShowAntecipar] = useState(false)
  const [antecipPreview, setAntecipPreview] = useState<AnticipationPreview | null>(null)
  const [antecipLoading, setAntecipLoading] = useState(false)
  const [antecipConfirming, setAntecipConfirming] = useState(false)

  useEffect(() => {
    fetch(`/api/financeiro/contas-receber/${id}/parcelas`).then(r => r.json())
      .then(d => setInstallments(d.data ?? []))
      .catch(() => {})
      .finally(() => setInstallmentsLoading(false))
  }, [id])

  useEffect(() => {
    fetch(`/api/financeiro/contas-receber/${id}`).then(r => r.json())
      .then(d => {
        const c = d.data
        if (!c) { toast.error('Conta não encontrada'); router.push('/financeiro/contas-receber'); return }
        setConta(c)
        setBaixaAmount(String((c.total_amount - (c.received_amount || 0)) / 100))
      })
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
    fetch('/api/financeiro/contas-bancarias').then(r => r.json())
      .then(d => setContas(d.data ?? []))
      .catch(() => {})
  }, [id, router])

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
      const r2 = await fetch(`/api/financeiro/contas-receber/${id}`)
      const d2 = await r2.json()
      setConta(d2.data)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setBaixaSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Conta excluída'); router.push('/financeiro/contas-receber')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
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
    setShowAntecipar(true)
    setAntecipPreview(null)
    setAntecipLoading(true)
    try {
      const res = await fetch(`/api/financeiro/contas-receber/${id}/antecipar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro ao carregar preview')
      setAntecipPreview(d.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao carregar preview')
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
      if (!res.ok) throw new Error(d.error || 'Erro ao antecipar')
      toast.success('Antecipacao realizada com sucesso!')
      setShowAntecipar(false); setAntecipPreview(null)
      // Reload conta and installments
      const r2 = await fetch(`/api/financeiro/contas-receber/${id}`)
      const d2 = await r2.json()
      setConta(d2.data)
      const r3 = await fetch(`/api/financeiro/contas-receber/${id}/parcelas`)
      const d3 = await r3.json()
      setInstallments(d3.data ?? [])
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro ao antecipar') }
    finally { setAntecipConfirming(false) }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>
  if (!conta) return <div className="py-12 text-center text-red-500">Conta não encontrada</div>

  const remaining = conta.total_amount - (conta.received_amount || 0)
  const pctPaid = conta.total_amount > 0 ? ((conta.received_amount || 0) / conta.total_amount) * 100 : 0
  const isPaid = conta.status === 'RECEBIDO' || conta.status === 'PAGO'

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro/contas-receber" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{conta.description}</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[conta.status] || 'bg-gray-100 text-gray-500'}`}>
                {conta.status}
              </span>
              {conta.anticipated_at && (
                <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-800">
                  Antecipado
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {!isPaid && conta.status !== 'CANCELADO' && (
            <button type="button" onClick={() => setShowBaixa(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 font-medium">
              <CheckCircle className="h-4 w-4" /> Registrar Recebimento
            </button>
          )}
          {isAdmin && !isPaid && (
            <button type="button" onClick={() => router.push(`/financeiro/contas-receber/${id}/editar`)}
              className="flex items-center gap-2 px-4 py-2 text-sm border rounded-md hover:bg-gray-50 text-gray-700">
              <Pencil className="h-4 w-4" /> Editar
            </button>
          )}
          {isAdmin && (
            <button type="button" title="Excluir" onClick={() => setShowDelete(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-red-200 rounded-md hover:bg-red-50 text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="rounded-lg border bg-white p-5">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-500">Recebido: {fmt(conta.received_amount || 0)}</span>
          <span className="font-medium">Total: {fmt(conta.total_amount)}</span>
        </div>
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(pctPaid, 100)}%` }} />
        </div>
        {remaining > 0 && <p className="text-sm text-gray-500 mt-2">Restante: {fmt(remaining)}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 space-y-2">
          <h2 className="font-semibold text-gray-900">Detalhes</h2>
          <Row label="Cliente" value={conta.customers?.legal_name || '—'} />
          <Row label="Categoria" value={conta.categories?.name || '—'} />
          <Row label="Forma Pagamento" value={conta.payment_method || '—'} />
          <Row label="Vencimento" value={safeDate(conta.due_date, true)} />
          <Row label="Cadastrada em" value={safeDate(conta.created_at)} />
          {conta.service_orders && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">OS Vinculada</span>
              <Link href={`/os/${conta.service_orders.id}`} className="text-blue-600 hover:underline font-medium">
                OS-{String(conta.service_orders.os_number).padStart(4, '0')}
              </Link>
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-white p-5 space-y-2">
          <h2 className="font-semibold text-gray-900">Valores</h2>
          <Row label="Total" value={fmt(conta.total_amount)} />
          <Row label="Recebido" value={fmt(conta.received_amount || 0)} />
          <Row label="Restante" value={fmt(remaining)} />
        </div>
      </div>

      {conta.notes && (
        <div className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Observações</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{conta.notes}</p>
        </div>
      )}

      {/* Anticipation Summary */}
      {conta.anticipated_at && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-5 space-y-2">
          <h2 className="font-semibold text-purple-900 flex items-center gap-2">
            <Zap className="h-4 w-4" /> Antecipacao
          </h2>
          <Row label="Antecipado em" value={safeDate(conta.anticipated_at)} />
          {conta.anticipation_fee != null && <Row label="Taxa de antecipacao" value={`-${fmt(conta.anticipation_fee)}`} />}
          {conta.anticipated_amount != null && <Row label="Valor antecipado" value={fmt(conta.anticipated_amount)} />}
        </div>
      )}

      {/* Installments */}
      {(installments.length > 0 || installmentsLoading) && (
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Parcelas</h2>
            {canAnticipate() && (
              <button type="button" onClick={openAntecipar}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 font-medium">
                <Zap className="h-3.5 w-3.5" /> Antecipar
              </button>
            )}
          </div>
          {installmentsLoading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando parcelas...
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Valor</th>
                    <th className="px-3 py-2">Vencimento</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Pago em</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {installments.map(inst => (
                    <tr key={inst.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{inst.number}</td>
                      <td className="px-3 py-2">{fmt(inst.amount)}</td>
                      <td className="px-3 py-2">{safeDate(inst.due_date, true)}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[inst.status] || 'bg-gray-100 text-gray-500'}`}>
                          {inst.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {safeDate(inst.paid_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Anticipation Modal */}
      {showAntecipar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowAntecipar(false); setAntecipPreview(null) }}>
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
                          <td className="px-3 py-2">{fmt(inst.amount)}</td>
                          <td className="px-3 py-2">{safeDate(inst.due_date, true)}</td>
                          <td className="px-3 py-2 text-right">{inst.days_remaining}</td>
                          <td className="px-3 py-2 text-right text-red-600">-{fmt(inst.fee)}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmt(inst.net_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 rounded-md bg-gray-50 p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Valor total</span>
                    <span className="font-medium">{fmt(antecipPreview.total_amount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Taxa de antecipacao ({antecipPreview.fee_pct_per_day}%/dia)</span>
                    <span className="font-medium text-red-600">-{fmt(antecipPreview.total_fee)}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t pt-2">
                    <span className="font-semibold text-gray-900">Valor a receber</span>
                    <span className="font-bold text-green-600 text-base">{fmt(antecipPreview.anticipated_amount)}</span>
                  </div>
                </div>
                <div className="flex gap-3 justify-end mt-5">
                  <button type="button" onClick={() => { setShowAntecipar(false); setAntecipPreview(null) }}
                    className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
                  <button type="button" onClick={handleAntecipar} disabled={antecipConfirming}
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
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

      {/* Baixa modal */}
      {showBaixa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBaixa(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-600" /> Registrar Recebimento</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
                <input type="number" step="0.01" min="0" value={baixaAmount} onChange={e => setBaixaAmount(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data do Recebimento</label>
                <input type="date" value={baixaDate} onChange={e => setBaixaDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
              {contas.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Conta Bancária</label>
                  <select value={baixaAccountId} onChange={e => setBaixaAccountId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md bg-white">
                    <option value="">Selecione...</option>
                    {contas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowBaixa(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleBaixa} disabled={baixaSaving}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2">
                {baixaSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {baixaSaving ? 'Registrando...' : 'Confirmar Recebimento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Excluir conta a receber?</h2>
            <p className="text-sm text-gray-600 mb-4">Tem certeza que deseja excluir <strong>{conta.description}</strong>?</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowDelete(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value}</span>
    </div>
  )
}
