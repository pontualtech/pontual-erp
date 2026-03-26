'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function NovoProdutoPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    barcode: '',
    brand: '',
    unit: 'UN',
    cost_price: '',
    sale_price: '',
    min_stock: '0',
    max_stock: '0',
  })

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name) { toast.error('Nome e obrigatorio'); return }

    setLoading(true)
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        barcode: form.barcode || null,
        brand: form.brand || null,
        unit: form.unit,
        cost_price: Math.round(parseFloat(form.cost_price || '0') * 100),
        sale_price: Math.round(parseFloat(form.sale_price || '0') * 100),
        min_stock: parseInt(form.min_stock || '0', 10),
        max_stock: parseInt(form.max_stock || '0', 10),
      }

      const res = await fetch('/api/produtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar produto')

      toast.success('Produto cadastrado!')
      router.push('/produtos')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Novo Produto</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Informacoes basicas */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Informacoes</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Nome *</label>
            <input type="text" value={form.name} onChange={e => updateForm('name', e.target.value)}
              required className="w-full px-3 py-2 border rounded-md" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Descricao</label>
            <textarea value={form.description} onChange={e => updateForm('description', e.target.value)}
              rows={2} className="w-full px-3 py-2 border rounded-md resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Codigo de Barras</label>
              <input type="text" value={form.barcode} onChange={e => updateForm('barcode', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Marca</label>
              <input type="text" value={form.brand} onChange={e => updateForm('brand', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Unidade</label>
            <select value={form.unit} onChange={e => updateForm('unit', e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-white">
              <option value="UN">Unidade (UN)</option>
              <option value="KG">Quilograma (KG)</option>
              <option value="LT">Litro (LT)</option>
              <option value="MT">Metro (MT)</option>
              <option value="CX">Caixa (CX)</option>
              <option value="PC">Peca (PC)</option>
            </select>
          </div>
        </div>

        {/* Precos */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Precos</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Preco de Custo (R$)</label>
              <input type="number" step="0.01" min="0" value={form.cost_price}
                onChange={e => updateForm('cost_price', e.target.value)}
                placeholder="0,00" className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Preco de Venda (R$)</label>
              <input type="number" step="0.01" min="0" value={form.sale_price}
                onChange={e => updateForm('sale_price', e.target.value)}
                placeholder="0,00" className="w-full px-3 py-2 border rounded-md" />
            </div>
          </div>
        </div>

        {/* Estoque */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Estoque</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Estoque Minimo</label>
              <input type="number" min="0" value={form.min_stock}
                onChange={e => updateForm('min_stock', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Estoque Maximo</label>
              <input type="number" min="0" value={form.max_stock}
                onChange={e => updateForm('max_stock', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={loading}
            className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">
            {loading ? 'Salvando...' : 'Cadastrar Produto'}
          </button>
        </div>
      </form>
    </div>
  )
}
