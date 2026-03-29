'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'

interface SearchResult {
  id: string
  legal_name: string
}

interface Category {
  id: string
  name: string
}

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

  const [form, setForm] = useState({
    customer_id: '',
    description: '',
    notes: '',
    total_amount: '',
    due_date: '',
    payment_method: '',
    category_id: '',
    installment_count: '1',
  })

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Load categories and cost centers
  useEffect(() => {
    fetch('/api/financeiro/categorias?limit=100')
      .then(r => r.json())
      .then(d => setCategories(d.data ?? []))
      .catch(() => {})
    fetch('/api/financeiro/card-fees')
      .then(r => r.json())
      .then(d => setCardFees(d.data ?? []))
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
    if (!form.total_amount || Number(form.total_amount) <= 0) { toast.error('Valor deve ser maior que zero'); return }
    if (!form.due_date) { toast.error('Data de vencimento e obrigatoria'); return }

    setLoading(true)
    try {
      const amountInCents = Math.round(Number(form.total_amount) * 100)
      const installmentCount = Number(form.installment_count) || 1

      const res = await fetch('/api/financeiro/contas-receber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: form.description,
          total_amount: amountInCents,
          due_date: form.due_date,
          customer_id: form.customer_id || undefined,
          category_id: form.category_id || undefined,
          payment_method: form.payment_method || undefined,
          notes: form.notes || undefined,
          installment_count: installmentCount > 1 ? installmentCount : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      toast.success('Conta a receber cadastrada!')
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="payment_method" className="block text-sm text-gray-600 mb-1">Forma de Pagamento</label>
              <select
                id="payment_method"
                value={form.payment_method}
                onChange={e => updateForm('payment_method', e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm"
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
              <label htmlFor="installment_count" className="block text-sm text-gray-600 mb-1">Parcelas</label>
              <select
                id="installment_count"
                value={form.installment_count}
                onChange={e => updateForm('installment_count', e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm"
              >
                {Array.from({ length: 24 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={String(n)}>{n}x{form.total_amount && Number(form.total_amount) > 0 ? ` de R$ ${(Number(form.total_amount) / n).toFixed(2)}` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Card fee preview */}
          {(() => {
            const isCard = /cart[aã]o|cr[eé]dito|credito/i.test(form.payment_method)
            const installments = Number(form.installment_count) || 1
            const amount = Number(form.total_amount) || 0
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
                  <span className="text-gray-600">Valor total:</span>
                  <span className="font-medium text-gray-900">{fmtBRL(amountCents)}</span>
                </div>
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

        {/* Classificacao */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Classificacao</h2>
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
