'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Package, Wrench } from 'lucide-react'
import { MoneyInput } from '@/app/(dashboard)/components/money-input'

export default function EditarProdutoPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tipo, setTipo] = useState<'produto' | 'servico'>('produto')
  const [form, setForm] = useState({
    name: '', description: '', barcode: '', brand: '', unit: 'UN',
    cost_price: '', sale_price: '', min_stock: '0', max_stock: '0',
  })

  useEffect(() => {
    fetch(`/api/produtos/${id}`)
      .then(r => r.json())
      .then(d => {
        const p = d.data
        if (!p) { toast.error('Produto não encontrado'); router.push('/produtos'); return }
        const isServ = p.unit === 'SV'
        setTipo(isServ ? 'servico' : 'produto')
        setForm({
          name: p.name || '', description: p.description || '', barcode: p.barcode || '',
          brand: p.brand || '', unit: p.unit || 'UN',
          cost_price: p.cost_price ? String(p.cost_price / 100) : '',
          sale_price: p.sale_price ? String(p.sale_price / 100) : '',
          min_stock: String(p.min_stock || 0), max_stock: String(p.max_stock || 0),
        })
      })
      .catch(() => { toast.error('Erro ao carregar'); router.push('/produtos') })
      .finally(() => setLoading(false))
  }, [id, router])

  function update(field: string, value: string) { setForm(prev => ({ ...prev, [field]: value })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/produtos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(), description: form.description || null,
          barcode: form.barcode || null, brand: form.brand || null,
          unit: tipo === 'servico' ? 'SV' : form.unit,
          cost_price: Math.round(parseFloat(form.cost_price || '0') * 100),
          sale_price: Math.round(parseFloat(form.sale_price || '0') * 100),
          min_stock: tipo === 'servico' ? 0 : parseInt(form.min_stock || '0'),
          max_stock: tipo === 'servico' ? 0 : parseInt(form.max_stock || '0'),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro ao salvar')
      toast.success('Produto atualizado!')
      router.push(`/produtos/${id}`)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>

  const inp = "w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors"

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/produtos/${id}`} className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="text-2xl font-bold text-gray-900">Editar {tipo === 'servico' ? 'Serviço' : 'Produto'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex gap-3">
          <button type="button" onClick={() => setTipo('produto')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border-2 font-medium transition-colors ${
              tipo === 'produto' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500'
            }`}><Package className="h-5 w-5" /> Produto</button>
          <button type="button" onClick={() => setTipo('servico')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border-2 font-medium transition-colors ${
              tipo === 'servico' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-500'
            }`}><Wrench className="h-5 w-5" /> Serviço</button>
        </div>

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Informações</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
            <input type="text" value={form.name} onChange={e => update('name', e.target.value)} required className={inp} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
            <textarea value={form.description} onChange={e => update('description', e.target.value)} rows={2} className={inp + " resize-none"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {tipo === 'produto' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código de Barras</label>
                <input type="text" value={form.barcode} onChange={e => update('barcode', e.target.value)} className={inp} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Marca</label>
              <input type="text" value={form.brand} onChange={e => update('brand', e.target.value)} className={inp} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Preços</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preço de Custo (R$)</label>
              <MoneyInput value={parseFloat(form.cost_price) || 0} onChange={v => update('cost_price', String(v))} placeholder="0,00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preço de Venda (R$)</label>
              <MoneyInput value={parseFloat(form.sale_price) || 0} onChange={v => update('sale_price', String(v))} placeholder="0,00" />
            </div>
          </div>
        </div>

        {tipo === 'produto' && (
          <div className="rounded-lg border bg-white p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Estoque</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estoque Mínimo</label>
                <input type="number" min="0" value={form.min_stock} onChange={e => update('min_stock', e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estoque Máximo</label>
                <input type="number" min="0" value={form.max_stock} onChange={e => update('max_stock', e.target.value)} className={inp} />
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={() => router.push(`/produtos/${id}`)}
            className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>
    </div>
  )
}
