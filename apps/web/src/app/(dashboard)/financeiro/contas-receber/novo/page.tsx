'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function NovaContaReceberPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<Array<{ id: string; legal_name: string }>>([])
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; legal_name: string } | null>(null)

  const [form, setForm] = useState({
    customer_id: '',
    description: '',
    notes: '',
    total_amount: '',
    due_date: '',
    payment_method: '',
  })

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function searchCustomers(query: string) {
    setCustomerSearch(query)
    if (query.length < 2) { setCustomers([]); return }

    try {
      const res = await fetch(`/api/clientes?search=${encodeURIComponent(query)}&limit=5`)
      const json = await res.json()
      setCustomers(json.data || [])
    } catch { setCustomers([]) }
  }

  function selectCustomer(customer: { id: string; legal_name: string }) {
    setSelectedCustomer(customer)
    setCustomerSearch(customer.legal_name)
    setCustomers([])
    updateForm('customer_id', customer.id)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.description) { toast.error('Descrição é obrigatória'); return }
    if (!form.total_amount || Number(form.total_amount) <= 0) { toast.error('Valor deve ser maior que zero'); return }
    if (!form.due_date) { toast.error('Data de vencimento é obrigatória'); return }

    setLoading(true)
    try {
      const amountInCents = Math.round(Number(form.total_amount) * 100)

      const res = await fetch('/api/financeiro/contas-receber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          total_amount: amountInCents,
          customer_id: form.customer_id || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      toast.success('Conta a receber cadastrada!')
      router.push('/financeiro/contas-receber')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Nova Conta a Receber</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cliente */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Cliente</h2>
          <div className="relative">
            <label className="block text-sm text-gray-600 mb-1">Buscar cliente (opcional)</label>
            <input
              type="text"
              value={customerSearch}
              onChange={e => searchCustomers(e.target.value)}
              placeholder="Digite o nome do cliente..."
              className="w-full px-3 py-2 border rounded-md"
            />
            {customers.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-40 overflow-y-auto">
                {customers.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                  >
                    {c.legal_name}
                  </button>
                ))}
              </div>
            )}
            {selectedCustomer && (
              <p className="text-sm text-green-600 mt-1">✓ {selectedCustomer.legal_name}</p>
            )}
          </div>
        </div>

        {/* Detalhes */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Detalhes</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Descrição *</label>
            <input
              type="text"
              value={form.description}
              onChange={e => updateForm('description', e.target.value)}
              placeholder="Ex: OS #0004 - Manutenção impressora HP"
              required
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Valor (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.total_amount}
                onChange={e => updateForm('total_amount', e.target.value)}
                placeholder="0,00"
                required
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Vencimento *</label>
              <input
                type="date"
                value={form.due_date}
                onChange={e => updateForm('due_date', e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Forma de Pagamento</label>
            <select
              value={form.payment_method}
              onChange={e => updateForm('payment_method', e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">Selecione...</option>
              <option value="DINHEIRO">Dinheiro</option>
              <option value="PIX">Pix</option>
              <option value="CARTAO_CREDITO">Cartão de Crédito</option>
              <option value="CARTAO_DEBITO">Cartão de Débito</option>
              <option value="BOLETO">Boleto</option>
              <option value="TRANSFERENCIA">Transferência</option>
            </select>
          </div>
        </div>

        {/* Observações */}
        <div className="rounded-lg border bg-white p-5">
          <label className="block text-sm text-gray-600 mb-1">Observações</label>
          <textarea
            value={form.notes}
            onChange={e => updateForm('notes', e.target.value)}
            rows={2}
            placeholder="Informações adicionais..."
            className="w-full px-3 py-2 border rounded-md resize-none"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {loading ? 'Salvando...' : 'Cadastrar Conta a Receber'}
          </button>
        </div>
      </form>
    </div>
  )
}
