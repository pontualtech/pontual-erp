'use client'

import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'

interface Cliente {
  id: string
  legal_name: string
  document_number: string | null
}

interface Item {
  product_name: string
  quantity: number
  unit_price_cents: number
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function EmitirNfePage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [items, setItems] = useState<Item[]>([{ product_name: '', quantity: 1, unit_price_cents: 0 }])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    fetch('/api/clientes?limit=500')
      .then(r => r.json())
      .then(d => setClientes(d.data ?? []))
      .catch(() => {})
  }, [])

  const totalCents = items.reduce((sum, i) => sum + i.quantity * i.unit_price_cents, 0)

  function updateItem(index: number, field: keyof Item, value: string | number) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  function addItem() {
    setItems(prev => [...prev, { product_name: '', quantity: 1, unit_price_cents: 0 }])
  }

  function removeItem(index: number) {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/fiscal/emitir-nfe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCustomerId,
          items: items.map(i => ({
            product_name: i.product_name,
            quantity: i.quantity,
            unit_price_cents: i.unit_price_cents,
          })),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ success: true, message: data.message ?? 'NF-e enviada para processamento!' })
      } else {
        setResult({ success: false, message: data.error ?? 'Erro ao emitir NF-e' })
      }
    } catch {
      setResult({ success: false, message: 'Erro de conexao' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Emitir NF-e</h1>

      {/* Homologacao banner */}
      <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
        <strong>HOMOLOGACAO</strong> — Esta emissao sera feita em ambiente de homologacao (testes). Nenhuma nota fiscal real sera gerada.
      </div>

      {result && (
        <div className={`rounded-md border px-4 py-3 text-sm ${result.success ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
          {result.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border bg-white p-6 shadow-sm">
        {/* Customer select */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
          <select
            required
            value={selectedCustomerId}
            onChange={e => setSelectedCustomerId(e.target.value)}
            className="w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Selecione um cliente...</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>
                {c.legal_name} {c.document_number ? `(${c.document_number})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Items */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Itens</label>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="flex items-end gap-3">
                <div className="flex-1">
                  {idx === 0 && <span className="text-xs text-gray-500">Produto</span>}
                  <input
                    required
                    placeholder="Nome do produto"
                    value={item.product_name}
                    onChange={e => updateItem(idx, 'product_name', e.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div className="w-24">
                  {idx === 0 && <span className="text-xs text-gray-500">Qtd</span>}
                  <input
                    required
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div className="w-36">
                  {idx === 0 && <span className="text-xs text-gray-500">Preco (centavos)</span>}
                  <input
                    required
                    type="number"
                    min={0}
                    value={item.unit_price_cents}
                    onChange={e => updateItem(idx, 'unit_price_cents', parseInt(e.target.value) || 0)}
                    className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="mb-0.5 rounded p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addItem}
            className="mt-3 flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            <Plus className="h-4 w-4" /> Adicionar item
          </button>
        </div>

        {/* Total */}
        <div className="flex items-center justify-between border-t pt-4">
          <span className="text-lg font-semibold text-gray-900">Total: {formatCurrency(totalCents)}</span>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Emitindo...' : 'Emitir NF-e'}
          </button>
        </div>
      </form>
    </div>
  )
}
