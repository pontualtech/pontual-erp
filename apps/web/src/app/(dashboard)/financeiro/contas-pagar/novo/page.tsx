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

interface CostCenter {
  id: string
  name: string
}

export default function NovaContaPagarPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Supplier search
  const [supplierSearch, setSupplierSearch] = useState('')
  const [suppliers, setSuppliers] = useState<SearchResult[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<SearchResult | null>(null)

  // Selects data
  const [categories, setCategories] = useState<Category[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])

  const [form, setForm] = useState({
    supplier_id: '',
    description: '',
    notes: '',
    total_amount: '',
    due_date: '',
    payment_method: '',
    category_id: '',
    cost_center_id: '',
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

    fetch('/api/financeiro/centros-custo?limit=100')
      .then(r => r.json())
      .then(d => setCostCenters(d.data ?? []))
      .catch(() => {})
  }, [])

  async function searchSuppliers(query: string) {
    setSupplierSearch(query)
    if (query.length < 2) { setSuppliers([]); return }
    try {
      const res = await fetch(`/api/clientes?search=${encodeURIComponent(query)}&limit=5`)
      const json = await res.json()
      setSuppliers(json.data || [])
    } catch { setSuppliers([]) }
  }

  function selectSupplier(supplier: SearchResult) {
    setSelectedSupplier(supplier)
    setSupplierSearch(supplier.legal_name)
    setSuppliers([])
    updateForm('supplier_id', supplier.id)
  }

  function clearSupplier() {
    setSelectedSupplier(null)
    setSupplierSearch('')
    updateForm('supplier_id', '')
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

      const res = await fetch('/api/financeiro/contas-pagar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: form.description,
          total_amount: amountInCents,
          due_date: form.due_date,
          supplier_id: form.supplier_id || undefined,
          category_id: form.category_id || undefined,
          cost_center_id: form.cost_center_id || undefined,
          payment_method: form.payment_method || undefined,
          notes: form.notes || undefined,
          installment_count: installmentCount > 1 ? installmentCount : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      toast.success('Conta a pagar cadastrada!')
      router.push('/financeiro/contas-pagar')
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
          href="/financeiro/contas-pagar"
          className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nova Conta a Pagar</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <Link href="/financeiro" className="text-blue-600 hover:underline">Financeiro</Link>
            {' / '}
            <Link href="/financeiro/contas-pagar" className="text-blue-600 hover:underline">Contas a Pagar</Link>
            {' / Novo'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Fornecedor */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Fornecedor</h2>
          <div className="relative">
            <label htmlFor="supplier-search" className="block text-sm text-gray-600 mb-1">Buscar fornecedor (opcional)</label>
            <input
              id="supplier-search"
              type="text"
              value={supplierSearch}
              onChange={e => searchSuppliers(e.target.value)}
              placeholder="Digite o nome do fornecedor..."
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
            {suppliers.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-40 overflow-y-auto">
                {suppliers.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectSupplier(s)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                  >
                    {s.legal_name}
                  </button>
                ))}
              </div>
            )}
            {selectedSupplier && (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-green-600">Selecionado: {selectedSupplier.legal_name}</p>
                <button type="button" onClick={clearSupplier} className="text-xs text-red-500 hover:underline">Remover</button>
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
              placeholder="Ex: Aluguel escritorio, compra de material..."
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
        </div>

        {/* Classificacao */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Classificacao</h2>
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label htmlFor="cost_center_id" className="block text-sm text-gray-600 mb-1">Centro de Custo</label>
              <select
                id="cost_center_id"
                value={form.cost_center_id}
                onChange={e => updateForm('cost_center_id', e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm"
              >
                <option value="">Selecione...</option>
                {costCenters.map(cc => (
                  <option key={cc.id} value={cc.id}>{cc.name}</option>
                ))}
              </select>
            </div>
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
            className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
          >
            {loading ? 'Salvando...' : 'Cadastrar Conta a Pagar'}
          </button>
        </div>
      </form>
    </div>
  )
}
