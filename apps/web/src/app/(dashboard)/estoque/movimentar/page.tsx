'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface ProdutoBusca {
  id: string
  name: string
  barcode: string | null
  current_stock: number
  unit: string
}

export default function MovimentarEstoquePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const [selectedProduct, setSelectedProduct] = useState<ProdutoBusca | null>(null)

  const [movementType, setMovementType] = useState<'ENTRY' | 'EXIT'>('ENTRY')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  async function searchProducts(term: string) {
    setSearchTerm(term)
    if (term.length < 2) { setResultados([]); return }

    setSearching(true)
    try {
      const res = await fetch(`/api/produtos?search=${encodeURIComponent(term)}&limit=10`)
      const data = await res.json()
      setResultados(data.data ?? [])
    } catch {
      setResultados([])
    } finally {
      setSearching(false)
    }
  }

  function selectProduct(p: ProdutoBusca) {
    setSelectedProduct(p)
    setSearchTerm(p.name)
    setResultados([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProduct) { toast.error('Selecione um produto'); return }
    if (!quantity || parseInt(quantity, 10) <= 0) { toast.error('Informe a quantidade'); return }
    if (!reason) { toast.error('Informe o motivo'); return }

    setLoading(true)
    try {
      const payload = {
        product_id: selectedProduct.id,
        movement_type: movementType,
        quantity: parseInt(quantity, 10),
        reason,
        notes: notes || null,
      }

      const res = await fetch('/api/estoque/movimentar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao movimentar estoque')

      toast.success('Movimentacao registrada!')
      router.push('/estoque')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/estoque" className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Movimentar Estoque</h1>
          <p className="text-sm text-gray-500">
            <Link href="/estoque" className="text-blue-600 hover:underline">Estoque</Link> / Movimentar
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Produto */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Produto</h2>
          <div className="relative">
            <label className="block text-sm text-gray-600 mb-1">Buscar Produto *</label>
            <input
              type="text"
              value={searchTerm}
              onChange={e => { searchProducts(e.target.value); setSelectedProduct(null) }}
              placeholder="Digite o nome ou codigo de barras..."
              className="w-full px-3 py-2 border rounded-md"
            />
            {searching && <p className="text-xs text-gray-400 mt-1">Buscando...</p>}
            {resultados.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-y-auto">
                {resultados.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProduct(p)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex justify-between"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-gray-400">Estoque: {p.current_stock} {p.unit}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedProduct && (
            <div className="rounded-md bg-blue-50 p-3 text-sm">
              <p className="font-medium text-blue-900">{selectedProduct.name}</p>
              <p className="text-blue-700">Estoque atual: {selectedProduct.current_stock} {selectedProduct.unit}</p>
            </div>
          )}
        </div>

        {/* Tipo e quantidade */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Movimentacao</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Tipo *</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" name="type" value="ENTRY" checked={movementType === 'ENTRY'}
                  onChange={() => setMovementType('ENTRY')} />
                <span className="text-sm text-green-700 font-medium">Entrada</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="type" value="EXIT" checked={movementType === 'EXIT'}
                  onChange={() => setMovementType('EXIT')} />
                <span className="text-sm text-red-700 font-medium">Saida</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Quantidade *</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Motivo *</label>
            <select value={reason} onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 border rounded-md bg-white">
              <option value="">Selecione...</option>
              <option value="COMPRA">Compra</option>
              <option value="VENDA">Venda</option>
              <option value="AJUSTE">Ajuste de inventario</option>
              <option value="DEVOLUCAO">Devolucao</option>
              <option value="PERDA">Perda / Avaria</option>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="OUTRO">Outro</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Observacoes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} className="w-full px-3 py-2 border rounded-md resize-none"
              placeholder="Detalhes adicionais..." />
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={loading}
            className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">
            {loading ? 'Salvando...' : 'Registrar Movimentacao'}
          </button>
        </div>
      </form>
    </div>
  )
}
