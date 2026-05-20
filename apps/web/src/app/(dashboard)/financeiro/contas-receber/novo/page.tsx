'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface SearchResult {
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
  bank_name?: string | null
}

// Split payment 2026-05-19: cada linha representa uma forma de pagamento
// dentro do recebivel. Soma de splits.amount precisa bater com total_amount.
interface Split {
  payment_method: string
  account_id: string
  amount_str: string // string pra suportar digitacao parcial; converte pra centavos no submit
  installment_count: string
}

const emptySplit = (): Split => ({ payment_method: '', account_id: '', amount_str: '', installment_count: '1' })

export default function NovaContaReceberPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<SearchResult[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<SearchResult | null>(null)

  // Selects data
  const [categories, setCategories] = useState<Category[]>([])
  const [cardFees, setCardFees] = useState<any[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])

  const [form, setForm] = useState({
    customer_id: '',
    description: '',
    notes: '',
    total_amount: '',
    due_date: '',
    category_id: '',
  })

  const [splits, setSplits] = useState<Split[]>([emptySplit()])

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function updateSplit(idx: number, field: keyof Split, value: string) {
    setSplits(prev => prev.map((sp, i) => i === idx ? { ...sp, [field]: value } : sp))
  }

  function addSplit() { setSplits(prev => [...prev, emptySplit()]) }
  function removeSplit(idx: number) { setSplits(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev) }

  // Quando ha 1 split, ele assume o total automaticamente (UX simples).
  // Quando ha 2+, usuario distribui manualmente.
  const isSingleSplit = splits.length === 1
  const splitsSum = splits.reduce((s, sp) => s + (Number(sp.amount_str.replace(',', '.')) || 0), 0)
  const totalNum = Number(form.total_amount.replace(',', '.')) || 0
  const sumValid = isSingleSplit ? true : Math.abs(splitsSum - totalNum) < 0.005
  const sumDiff = totalNum - splitsSum

  // Load categories, card fees and bank accounts
  useEffect(() => {
    fetch('/api/financeiro/categorias?limit=100')
      .then(r => r.json())
      .then(d => setCategories(d.data ?? []))
      .catch(() => {})
    fetch('/api/financeiro/card-fees')
      .then(r => r.json())
      .then(d => setCardFees(d.data ?? []))
      .catch(() => {})
    fetch('/api/financeiro/contas-bancarias')
      .then(r => r.json())
      .then(d => setBankAccounts(d.data ?? []))
      .catch(() => {})
  }, [])

  async function searchCustomers(query: string) {
    setCustomerSearch(query)
    if (query.length < 2) { setCustomers([]); return }
    try {
      const res = await fetch(`/api/clientes?search=${encodeURIComponent(query)}&limit=5`)
      const json = await res.json()
      setCustomers(json.data || [])
    } catch { setCustomers([]) }
  }

  function selectCustomer(customer: SearchResult) {
    setSelectedCustomer(customer)
    setCustomerSearch(customer.legal_name)
    setCustomers([])
    updateForm('customer_id', customer.id)
  }

  function clearCustomer() {
    setSelectedCustomer(null)
    setCustomerSearch('')
    updateForm('customer_id', '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.description) { toast.error('Descricao e obrigatoria'); return }
    if (!form.total_amount || Number(form.total_amount.replace(',', '.')) <= 0) { toast.error('Valor deve ser maior que zero'); return }
    if (!form.due_date) { toast.error('Data de vencimento e obrigatoria'); return }
    if (!sumValid) { toast.error(`Soma das formas (R$ ${splitsSum.toFixed(2)}) deve ser igual ao total (R$ ${totalNum.toFixed(2)})`); return }

    setLoading(true)
    try {
      const amountInCents = Math.round(totalNum * 100)

      // Multi-split: envia splits[]. Single-split: backward compat com campos planos
      // (mesmo payload aceito pelo backend).
      const splitsPayload = splits.map(sp => ({
        payment_method: sp.payment_method || undefined,
        account_id: sp.account_id || undefined,
        amount: Math.round((Number(sp.amount_str.replace(',', '.')) || (isSingleSplit ? totalNum : 0)) * 100),
        installment_count: Number(sp.installment_count) > 1 ? Number(sp.installment_count) : undefined,
      }))

      // Valida soma final em centavos (evita drift float)
      const sumCents = splitsPayload.reduce((s, x) => s + x.amount, 0)
      if (sumCents !== amountInCents) {
        // Em single split, sobreescreve amount pro total (UX: usuario nao precisou
        // digitar amount no split)
        if (isSingleSplit) splitsPayload[0].amount = amountInCents
        else { toast.error(`Soma exata em centavos diverge (${sumCents} vs ${amountInCents})`); setLoading(false); return }
      }

      const body: any = {
        description: form.description,
        total_amount: amountInCents,
        due_date: form.due_date,
        customer_id: form.customer_id || undefined,
        category_id: form.category_id || undefined,
        notes: form.notes || undefined,
      }
      if (splits.length > 1) {
        body.splits = splitsPayload
      } else {
        // Backward compat: 1 split usa campos planos (zero risco em testes/integracoes)
        body.payment_method = splits[0].payment_method || undefined
        body.account_id = splits[0].account_id || undefined
        body.installment_count = Number(splits[0].installment_count) > 1 ? Number(splits[0].installment_count) : undefined
      }

      const res = await fetch('/api/financeiro/contas-receber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      toast.success(splits.length > 1 ? `${splits.length} contas a receber cadastradas (grupo)!` : 'Conta a receber cadastrada!')
      router.push('/financeiro/contas-receber')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cadastrar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/financeiro/contas-receber"
          className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nova Conta a Receber</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <Link href="/financeiro" className="text-emerald-600 hover:underline">Financeiro</Link>
            {' / '}
            <Link href="/financeiro/contas-receber" className="text-emerald-600 hover:underline">Contas a Receber</Link>
            {' / Novo'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Cliente */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Cliente</h2>
          <div className="relative">
            <label htmlFor="customer-search" className="block text-sm text-gray-600 mb-1">Buscar cliente (opcional)</label>
            <input
              id="customer-search"
              type="text"
              value={customerSearch}
              onChange={e => searchCustomers(e.target.value)}
              placeholder="Digite o nome do cliente..."
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
            {customers.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-40 overflow-y-auto">
                {customers.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-sm"
                  >
                    {c.legal_name}
                  </button>
                ))}
              </div>
            )}
            {selectedCustomer && (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-green-600">Selecionado: {selectedCustomer.legal_name}</p>
                <button type="button" onClick={clearCustomer} className="text-xs text-red-500 hover:underline">Remover</button>
              </div>
            )}
          </div>
        </div>

        {/* Detalhes */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Detalhes</h2>
          <div>
            <label htmlFor="description" className="block text-sm text-gray-600 mb-1">Descricao *</label>
            <input
              id="description"
              type="text"
              value={form.description}
              onChange={e => updateForm('description', e.target.value)}
              placeholder="Ex: OS #0004 - Manutencao impressora HP"
              required
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="total_amount" className="block text-sm text-gray-600 mb-1">Valor (R$) *</label>
              <input
                id="total_amount"
                type="number"
                step="0.01"
                min="0.01"
                value={form.total_amount}
                onChange={e => updateForm('total_amount', e.target.value)}
                placeholder="0,00"
                required
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
            <div>
              <label htmlFor="due_date" className="block text-sm text-gray-600 mb-1">Vencimento *</label>
              <input
                id="due_date"
                type="date"
                value={form.due_date}
                onChange={e => updateForm('due_date', e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
          </div>
        </div>

        {/* Formas de pagamento (split) */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Formas de Pagamento</h2>
            <button
              type="button"
              onClick={addSplit}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar forma
            </button>
          </div>

          {splits.map((sp, idx) => {
            const showHeader = splits.length > 1
            // Quando ha 1 split, ele assume o total automaticamente (sem precisar digitar)
            const displayAmount = isSingleSplit && totalNum > 0 ? totalNum.toFixed(2).replace('.', ',') : sp.amount_str
            return (
              <div key={idx} className={`${showHeader ? 'border rounded-lg p-3 space-y-2 bg-gray-50' : 'space-y-2'}`}>
                {showHeader && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">Forma {idx + 1}</span>
                    {splits.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSplit(idx)}
                        className="text-gray-400 hover:text-red-600 cursor-pointer"
                        title="Remover esta forma"
                        aria-label={`Remover forma ${idx + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Forma</label>
                    <select
                      aria-label={`Forma de pagamento ${idx + 1}`}
                      value={sp.payment_method}
                      onChange={e => updateSplit(idx, 'payment_method', e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                    >
                      <option value="">Selecione...</option>
                      <option value="DINHEIRO">Dinheiro</option>
                      <option value="PIX">Pix</option>
                      <option value="CARTAO_CREDITO">Cartao de Credito</option>
                      <option value="CARTAO_DEBITO">Cartao de Debito</option>
                      <option value="BOLETO">Boleto</option>
                      <option value="TRANSFERENCIA">Transferencia</option>
                      <option value="CHEQUE">Cheque</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Parcelas</label>
                    <select
                      aria-label={`Parcelas da forma ${idx + 1}`}
                      value={sp.installment_count}
                      onChange={e => updateSplit(idx, 'installment_count', e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={String(n)}>{n}x</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Banco destino</label>
                    <select
                      aria-label={`Banco destino da forma ${idx + 1}`}
                      value={sp.account_id}
                      onChange={e => updateSplit(idx, 'account_id', e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                    >
                      <option value="">Nenhum (definir na baixa)</option>
                      {bankAccounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}{acc.bank_name ? ` — ${acc.bank_name}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {showHeader && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Valor desta forma (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={displayAmount}
                        onChange={e => updateSplit(idx, 'amount_str', e.target.value)}
                        placeholder="0,00"
                        className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Validador de soma — so aparece quando ha 2+ splits */}
          {splits.length > 1 && (
            <div className={`rounded-md border p-2.5 text-xs flex items-center justify-between ${sumValid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              <span>Soma das formas:</span>
              <span className="font-bold">
                R$ {splitsSum.toFixed(2)} / R$ {totalNum.toFixed(2)}
                {!sumValid && sumDiff !== 0 && <span className="ml-2 font-normal">(falta R$ {sumDiff.toFixed(2)})</span>}
                {sumValid && ' ✓'}
              </span>
            </div>
          )}

          {/* Card fee preview — so quando 1 split de cartao */}
          {isSingleSplit && (() => {
            const sp = splits[0]
            const isCard = /cart[aã]o|cr[eé]dito|credito/i.test(sp.payment_method)
            const installments = Number(sp.installment_count) || 1
            const amount = totalNum
            if (!isCard || installments <= 1 || amount <= 0 || cardFees.length === 0) return null
            const amountCents = Math.round(amount * 100)
            const range = cardFees[0]?.installments?.find((r: any) => installments >= r.from && installments <= r.to)
            const feePct = range?.fee_pct || 0
            if (feePct <= 0) return null
            const feeAmount = Math.round(amountCents * (feePct / 100))
            const netAmount = amountCents - feeAmount
            const fmtBRL = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            return (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">{installments}x de</span>
                  <span className="font-medium text-gray-900">{fmtBRL(Math.round(amountCents / installments))}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>Taxa operadora ({feePct}%):</span>
                  <span className="font-medium">-{fmtBRL(feeAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-amber-200 pt-1">
                  <span className="font-medium text-gray-700">Valor liquido:</span>
                  <span className="font-bold text-green-700">{fmtBRL(netAmount)}</span>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Classificação */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Classificação</h2>
          <div>
            <label htmlFor="category_id" className="block text-sm text-gray-600 mb-1">Categoria</label>
            <select
              id="category_id"
              value={form.category_id}
              onChange={e => updateForm('category_id', e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm"
            >
              <option value="">Selecione...</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Conta bancária destino agora é definida em cada forma de pagamento (acima).
            </p>
          </div>
        </div>

        {/* Observacoes */}
        <div className="rounded-lg border bg-white p-5">
          <label htmlFor="notes" className="block text-sm text-gray-600 mb-1">Observacoes</label>
          <textarea
            id="notes"
            value={form.notes}
            onChange={e => updateForm('notes', e.target.value)}
            rows={2}
            placeholder="Informacoes adicionais..."
            className="w-full px-3 py-2 border rounded-md resize-none text-sm"
          />
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
            disabled={loading}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 font-medium text-sm"
          >
            {loading ? 'Salvando...' : 'Cadastrar Conta a Receber'}
          </button>
        </div>
      </form>
    </div>
  )
}
