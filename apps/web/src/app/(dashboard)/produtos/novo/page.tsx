'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Package, Wrench } from 'lucide-react'

export default function NovoProdutoPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [tipo, setTipo] = useState<'produto' | 'servico'>('produto')

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

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleTipoChange(t: 'produto' | 'servico') {
    setTipo(t)
    if (t === 'servico') {
      setForm(prev => ({ ...prev, unit: 'SV', min_stock: '0', max_stock: '0', barcode: '' }))
    } else {
      setForm(prev => ({ ...prev, unit: 'UN' }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return }

    setLoading(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        barcode: form.barcode || null,
        brand: form.brand || null,
        unit: tipo === 'servico' ? 'SV' : form.unit,
        cost_price: Math.round(parseFloat(form.cost_price || '0') * 100),
        sale_price: Math.round(parseFloat(form.sale_price || '0') * 100),
        min_stock: tipo === 'servico' ? 0 : parseInt(form.min_stock || '0', 10),
        max_stock: tipo === 'servico' ? 0 : parseInt(form.max_stock || '0', 10),
      }

      const res = await fetch('/api/produtos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      toast.success(tipo === 'servico' ? 'Serviço cadastrado!' : 'Produto cadastrado!')
      router.push('/produtos')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setLoading(false)
    }
  }

  const inp = "w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors"

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {tipo === 'servico' ? 'Novo Serviço' : 'Novo Produto'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Type selector */}
        <div className="flex gap-3">
          <button type="button" onClick={() => handleTipoChange('produto')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border-2 font-medium transition-colors ${
              tipo === 'produto'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}>
            <Package className="h-5 w-5" /> Produto
          </button>
          <button type="button" onClick={() => handleTipoChange('servico')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border-2 font-medium transition-colors ${
              tipo === 'servico'
                ? 'border-amber-500 bg-amber-50 text-amber-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}>
            <Wrench className="h-5 w-5" /> Serviço
          </button>
        </div>

        {/* Basic info */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Informações</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {tipo === 'servico' ? 'Nome do serviço *' : 'Nome do produto *'}
            </label>
            <input type="text" value={form.name} onChange={e => update('name', e.target.value)}
              placeholder={tipo === 'servico' ? 'Ex: Limpeza de cabeçote' : 'Ex: Toner HP 85A'}
              required className={inp} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
            <textarea value={form.description} onChange={e => update('description', e.target.value)}
              rows={2} placeholder="Detalhes adicionais..." className={inp + " resize-none"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {tipo === 'produto' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código de Barras</label>
                <input type="text" value={form.barcode} onChange={e => update('barcode', e.target.value)}
                  placeholder="EAN-13" className={inp} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Marca</label>
              <input type="text" value={form.brand} onChange={e => update('brand', e.target.value)}
                placeholder={tipo === 'servico' ? 'Opcional' : 'HP, Epson...'} className={inp} />
            </div>
            {tipo === 'produto' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unidade</label>
                <select value={form.unit} onChange={e => update('unit', e.target.value)} title="Unidade" className={inp}>
                  <option value="UN">Unidade (UN)</option>
                  <option value="KG">Quilograma (KG)</option>
                  <option value="LT">Litro (LT)</option>
                  <option value="MT">Metro (MT)</option>
                  <option value="CX">Caixa (CX)</option>
                  <option value="PC">Peça (PC)</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Prices */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Preços</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {tipo === 'servico' ? 'Custo (R$)' : 'Preço de Custo (R$)'}
              </label>
              <input type="number" step="0.01" min="0" value={form.cost_price}
                onChange={e => update('cost_price', e.target.value)}
                placeholder="0,00" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {tipo === 'servico' ? 'Valor Cobrado (R$)' : 'Preço de Venda (R$)'}
              </label>
              <input type="number" step="0.01" min="0" value={form.sale_price}
                onChange={e => update('sale_price', e.target.value)}
                placeholder="0,00" className={inp} />
            </div>
          </div>
        </div>

        {/* Stock - only for products */}
        {tipo === 'produto' && (
          <div className="rounded-lg border bg-white p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Estoque</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estoque Mínimo</label>
                <input type="number" min="0" value={form.min_stock}
                  onChange={e => update('min_stock', e.target.value)}
                  placeholder="0" className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estoque Máximo</label>
                <input type="number" min="0" value={form.max_stock}
                  onChange={e => update('max_stock', e.target.value)}
                  placeholder="0" className={inp} />
              </div>
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50
              font-medium transition-colors flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Salvando...' : tipo === 'servico' ? 'Cadastrar Serviço' : 'Cadastrar Produto'}
          </button>
        </div>
      </form>
    </div>
  )
}
