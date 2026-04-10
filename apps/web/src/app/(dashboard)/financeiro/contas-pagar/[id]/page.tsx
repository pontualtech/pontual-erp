'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, DollarSign, Loader2, Trash2, CheckCircle } from 'lucide-react'

function safeDate(v: any, utc = false): string {
  if (!v) return '--'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('pt-BR', utc ? { timeZone: 'UTC' } : undefined)
}

interface ContaPagar {
  id: string; description: string; total_amount: number; paid_amount: number
  due_date: string; status: string; payment_method: string | null; notes: string | null
  created_at: string; categories: { name: string } | null; cost_centers: { name: string } | null
  customers: { legal_name: string } | null
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

const statusColors: Record<string, string> = {
  PENDENTE: 'bg-blue-100 text-blue-700', VENCIDO: 'bg-red-100 text-red-700',
  PAGO: 'bg-green-100 text-green-700', CANCELADO: 'bg-gray-100 text-gray-500',
}

export default function ContaPagarDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [conta, setConta] = useState<ContaPagar | null>(null)
  const [loading, setLoading] = useState(true)
  const [showBaixa, setShowBaixa] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [baixaAmount, setBaixaAmount] = useState('')
  const [baixaDate, setBaixaDate] = useState(new Date().toISOString().split('T')[0])
  const [baixaSaving, setBaixaSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [contas, setContas] = useState<{ id: string; name: string }[]>([])
  const [baixaAccountId, setBaixaAccountId] = useState('')

  useEffect(() => {
    fetch(`/api/financeiro/contas-pagar/${id}`).then(r => r.json())
      .then(d => {
        const c = d.data
        if (!c) { toast.error('Conta não encontrada'); router.push('/financeiro/contas-pagar'); return }
        setConta(c)
        setBaixaAmount(String((c.total_amount - (c.paid_amount || 0)) / 100))
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
      const res = await fetch(`/api/financeiro/contas-pagar/${id}/baixa`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid_amount: Math.round(parseFloat(baixaAmount) * 100), paid_at: baixaDate, account_id: baixaAccountId || undefined }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Pagamento registrado!')
      setShowBaixa(false)
      // Reload
      const r2 = await fetch(`/api/financeiro/contas-pagar/${id}`)
      const d2 = await r2.json()
      setConta(d2.data)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setBaixaSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/contas-pagar/${id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Conta excluída'); router.push('/financeiro/contas-pagar')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>
  if (!conta) return <div className="py-12 text-center text-red-500">Conta não encontrada</div>

  const remaining = conta.total_amount - (conta.paid_amount || 0)
  const pctPaid = conta.total_amount > 0 ? ((conta.paid_amount || 0) / conta.total_amount) * 100 : 0

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro/contas-pagar" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{conta.description}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[conta.status] || 'bg-gray-100 text-gray-500'}`}>
              {conta.status}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {conta.status !== 'PAGO' && conta.status !== 'CANCELADO' && (
            <button type="button" onClick={() => setShowBaixa(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 font-medium">
              <CheckCircle className="h-4 w-4" /> Registrar Pagamento
            </button>
          )}
          <button type="button" onClick={() => setShowDelete(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-red-200 rounded-md hover:bg-red-50 text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Payment progress */}
      <div className="rounded-lg border bg-white p-5">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-500">Pago: {fmt(conta.paid_amount || 0)}</span>
          <span className="font-medium">Total: {fmt(conta.total_amount)}</span>
        </div>
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(pctPaid, 100)}%` }} />
        </div>
        {remaining > 0 && <p className="text-sm text-gray-500 mt-2">Restante: {fmt(remaining)}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 space-y-2">
          <h2 className="font-semibold text-gray-900">Detalhes</h2>
          <Row label="Fornecedor" value={conta.customers?.legal_name || '—'} />
          <Row label="Categoria" value={conta.categories?.name || '—'} />
          <Row label="Centro de Custo" value={conta.cost_centers?.name || '—'} />
          <Row label="Forma Pagamento" value={conta.payment_method || '—'} />
          <Row label="Vencimento" value={safeDate(conta.due_date, true)} />
          <Row label="Cadastrada em" value={safeDate(conta.created_at)} />
        </div>
        <div className="rounded-lg border bg-white p-5 space-y-2">
          <h2 className="font-semibold text-gray-900">Valores</h2>
          <Row label="Total" value={fmt(conta.total_amount)} />
          <Row label="Pago" value={fmt(conta.paid_amount || 0)} />
          <Row label="Restante" value={fmt(remaining)} />
        </div>
      </div>

      {conta.notes && (
        <div className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Observações</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{conta.notes}</p>
        </div>
      )}

      {/* Baixa modal */}
      {showBaixa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBaixa(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><DollarSign className="h-5 w-5 text-green-600" /> Registrar Pagamento</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
                <input type="number" step="0.01" min="0" value={baixaAmount} onChange={e => setBaixaAmount(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data do Pagamento</label>
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
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                {baixaSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {baixaSaving ? 'Registrando...' : 'Confirmar Pagamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Excluir conta a pagar?</h2>
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
