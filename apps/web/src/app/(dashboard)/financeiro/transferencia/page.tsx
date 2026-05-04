'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRightLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { MoneyInput } from '@/app/(dashboard)/components/money-input'

interface BankAccount {
  id: string
  name: string
  bank_name?: string | null
  current_balance?: number
}

export default function TransferenciaBancosPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState(0)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch('/api/financeiro/contas-bancarias')
      .then(r => r.json())
      .then(d => setAccounts(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar contas bancárias'))
      .finally(() => setLoading(false))
  }, [])

  const fromAccount = accounts.find(a => a.id === fromId)
  const toAccount = accounts.find(a => a.id === toId)
  const amountCents = Math.round(amount * 100)
  const fromBalance = fromAccount?.current_balance ?? 0
  const insufficient = fromAccount && amountCents > fromBalance
  const fmt = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fromId) { toast.error('Selecione a conta origem'); return }
    if (!toId) { toast.error('Selecione a conta destino'); return }
    if (fromId === toId) { toast.error('Conta origem e destino devem ser diferentes'); return }
    if (amountCents <= 0) { toast.error('Valor deve ser maior que zero'); return }
    if (insufficient) {
      const confirmed = window.confirm(
        `Saldo de ${fromAccount.name} (${fmt(fromBalance)}) é insuficiente. ` +
        `Confirmar transferência mesmo assim? Saldo ficará negativo.`
      )
      if (!confirmed) return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/financeiro/transferencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_account_id: fromId,
          to_account_id: toId,
          amount: amountCents,
          transfer_date: date,
          description: description.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erro ao transferir')
      toast.success(`Transferência ${fmt(amountCents)} ${fromAccount?.name} → ${toAccount?.name}`)
      router.push('/financeiro/extrato')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao transferir')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/financeiro" className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ArrowRightLeft className="h-6 w-6 text-blue-600" />
            Transferência entre Bancos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <Link href="/financeiro" className="text-blue-600 hover:underline">Financeiro</Link>
            {' / Transferência'}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando contas...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Origem */}
          <div className="rounded-lg border bg-white p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Conta de origem</h2>
            <div>
              <label htmlFor="from_account" className="block text-sm text-gray-600 mb-1">Conta bancária *</label>
              <select
                id="from_account"
                value={fromId}
                onChange={e => setFromId(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-md text-sm"
              >
                <option value="">Selecione...</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id} disabled={acc.id === toId}>
                    {acc.name}{acc.bank_name ? ` — ${acc.bank_name}` : ''}
                    {' • Saldo: '}{fmt(acc.current_balance ?? 0)}
                  </option>
                ))}
              </select>
              {fromAccount && (
                <p className="text-xs text-gray-500 mt-1">
                  Saldo atual: <span className="font-semibold text-gray-700">{fmt(fromBalance)}</span>
                </p>
              )}
            </div>
          </div>

          {/* Destino */}
          <div className="rounded-lg border bg-white p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Conta de destino</h2>
            <div>
              <label htmlFor="to_account" className="block text-sm text-gray-600 mb-1">Conta bancária *</label>
              <select
                id="to_account"
                value={toId}
                onChange={e => setToId(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-md text-sm"
              >
                <option value="">Selecione...</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id} disabled={acc.id === fromId}>
                    {acc.name}{acc.bank_name ? ` — ${acc.bank_name}` : ''}
                    {' • Saldo: '}{fmt(acc.current_balance ?? 0)}
                  </option>
                ))}
              </select>
              {toAccount && (
                <p className="text-xs text-gray-500 mt-1">
                  Saldo atual: <span className="font-semibold text-gray-700">{fmt(toAccount.current_balance ?? 0)}</span>
                  {' → ficará '}
                  <span className="font-semibold text-green-700">{fmt((toAccount.current_balance ?? 0) + amountCents)}</span>
                </p>
              )}
            </div>
          </div>

          {/* Valor + Data */}
          <div className="rounded-lg border bg-white p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Detalhes</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="amount" className="block text-sm text-gray-600 mb-1">Valor (R$) *</label>
                <MoneyInput value={amount} onChange={setAmount} placeholder="0,00" />
                {insufficient && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ Saldo origem ficará negativo: {fmt(fromBalance - amountCents)}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="date" className="block text-sm text-gray-600 mb-1">Data *</label>
                <input
                  id="date"
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border rounded-md text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="description" className="block text-sm text-gray-600 mb-1">Descrição (opcional)</label>
              <input
                id="description"
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ex: Reposição de saldo do operacional"
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium text-sm flex items-center justify-center gap-2"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Transferindo...</>
              ) : (
                <><ArrowRightLeft className="h-4 w-4" /> Confirmar Transferência</>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
