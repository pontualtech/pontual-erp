'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Eye, PackageCheck, XCircle, Loader2, ShoppingCart, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Supplier {
  id: string
  name: string
}

interface PurchaseItem {
  product_id: string
  product_name: string
  quantity: number
  unit_cost: number
}

interface Purchase {
  id: string
  number: string
  supplier_id: string
  supplier_name: string
  status: 'DRAFT' | 'SENT' | 'RECEIVED' | 'CANCELLED'
  total_cents: number
  expected_date: string | null
  notes: string | null
  items: PurchaseItem[]
  created_at: string
}

interface PurchaseForm {
  supplier_id: string
  expected_date: string
  notes: string
  items: { product_id: string; product_name: string; quantity: string; unit_cost: string }[]
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}

const statusConfig: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-100 text-gray-700' },
  SENT: { label: 'Enviado', color: 'bg-blue-100 text-blue-700' },
  RECEIVED: { label: 'Recebido', color: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'Cancelado', color: 'bg-red-100 text-red-700' },
}

export default function ComprasPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [form, setForm] = useState<PurchaseForm>({
    supplier_id: '', expected_date: '', notes: '',
    items: [{ product_id: '', product_name: '', quantity: '', unit_cost: '' }],
  })
  const [saving, setSaving] = useState(false)

  // Detail modal
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null)

  // Actions
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Product search for item rows
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<{ id: string; name: string; cost_price: number }[]>([])
  const [activeItemIdx, setActiveItemIdx] = useState<number | null>(null)

  function loadPurchases() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    fetch(`/api/purchases?${params}`)
      .then(r => r.json())
      .then(d => setPurchases(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar compras'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadPurchases() }, [search, statusFilter])

  function openCreate() {
    fetch('/api/suppliers')
      .then(r => r.json())
      .then(d => setSuppliers(d.data ?? []))
      .catch(() => {})
    setForm({
      supplier_id: '', expected_date: '', notes: '',
      items: [{ product_id: '', product_name: '', quantity: '', unit_cost: '' }],
    })
    setShowCreate(true)
  }

  async function searchProducts(term: string, idx: number) {
    setProductSearch(term)
    setActiveItemIdx(idx)
    if (term.length < 2) { setProductResults([]); return }
    try {
      const res = await fetch(`/api/produtos?search=${encodeURIComponent(term)}&limit=8`)
      const data = await res.json()
      setProductResults(data.data ?? [])
    } catch { setProductResults([]) }
  }

  function selectProduct(idx: number, p: { id: string; name: string; cost_price: number }) {
    const items = [...form.items]
    items[idx] = { ...items[idx], product_id: p.id, product_name: p.name, unit_cost: (p.cost_price / 100).toFixed(2) }
    setForm({ ...form, items })
    setProductResults([])
    setActiveItemIdx(null)
  }

  function addItem() {
    setForm({
      ...form,
      items: [...form.items, { product_id: '', product_name: '', quantity: '', unit_cost: '' }],
    })
  }

  function removeItem(idx: number) {
    if (form.items.length <= 1) return
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.supplier_id) { toast.error('Selecione um fornecedor'); return }
    const validItems = form.items.filter(i => i.product_id && i.quantity)
    if (validItems.length === 0) { toast.error('Adicione pelo menos um item'); return }

    setSaving(true)
    try {
      const payload = {
        supplier_id: form.supplier_id,
        expected_date: form.expected_date || null,
        notes: form.notes || null,
        items: validItems.map(i => ({
          product_id: i.product_id,
          quantity: parseInt(i.quantity, 10),
          unit_cost: Math.round(parseFloat(i.unit_cost || '0') * 100),
        })),
      }
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar pedido')
      toast.success('Pedido de compra criado!')
      setShowCreate(false)
      loadPurchases()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar')
    } finally {
      setSaving(false)
    }
  }

  async function handleReceive(id: string) {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/purchases/${id}/receive`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao receber')
      toast.success('Compra recebida! Estoque atualizado.')
      loadPurchases()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCancel(id: string) {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/purchases/${id}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cancelar')
      toast.success('Pedido cancelado.')
      loadPurchases()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos de Compra</h1>
          <p className="text-sm text-gray-500">
            <Link href="/produtos" className="text-blue-600 hover:underline">Estoque</Link> / Compras
          </p>
        </div>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Nova Compra
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            placeholder="Buscar por número, fornecedor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-md border bg-white px-3 py-2 text-sm">
          <option value="">Todos os status</option>
          <option value="DRAFT">Rascunho</option>
          <option value="SENT">Enviado</option>
          <option value="RECEIVED">Recebido</option>
          <option value="CANCELLED">Cancelado</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Número</th>
              <th className="px-4 py-3">Fornecedor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Data Prevista</th>
              <th className="px-4 py-3">Criado em</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin inline mr-2" />Carregando...
              </td></tr>
            ) : purchases.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                <ShoppingCart className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                Nenhum pedido de compra encontrado
              </td></tr>
            ) : (
              purchases.map(p => {
                const cfg = statusConfig[p.status] ?? statusConfig.DRAFT
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900">#{p.number}</td>
                    <td className="px-4 py-3 text-gray-700">{p.supplier_name}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', cfg.color)}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(p.total_cents)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(p.expected_date)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(p.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setDetailPurchase(p)} title="Ver detalhes"
                          className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                          <Eye className="h-4 w-4" />
                        </button>
                        {(p.status === 'DRAFT' || p.status === 'SENT') && (
                          <button type="button" onClick={() => handleReceive(p.id)} title="Receber"
                            disabled={actionLoading === p.id}
                            className="rounded p-1 text-gray-400 hover:bg-green-50 hover:text-green-600 transition-colors disabled:opacity-50">
                            {actionLoading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                          </button>
                        )}
                        {p.status !== 'RECEIVED' && p.status !== 'CANCELLED' && (
                          <button type="button" onClick={() => handleCancel(p.id)} title="Cancelar"
                            disabled={actionLoading === p.id}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50">
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Create Purchase Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Novo Pedido de Compra</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Fornecedor *</label>
                  <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm bg-white">
                    <option value="">Selecione...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Data Prevista</label>
                  <input type="date" value={form.expected_date} onChange={e => setForm({ ...form, expected_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm" />
                </div>
              </div>

              {/* Items */}
              <div>
                <label className="block text-sm text-gray-600 mb-2">Itens *</label>
                <div className="space-y-2">
                  {form.items.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={item.product_name}
                          onChange={e => {
                            const items = [...form.items]
                            items[idx] = { ...items[idx], product_name: e.target.value, product_id: '' }
                            setForm({ ...form, items })
                            searchProducts(e.target.value, idx)
                          }}
                          placeholder="Buscar produto..."
                          className="w-full px-3 py-2 border rounded-md text-sm"
                        />
                        {activeItemIdx === idx && productResults.length > 0 && (
                          <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg max-h-32 overflow-y-auto">
                            {productResults.map(p => (
                              <button key={p.id} type="button" onClick={() => selectProduct(idx, p)}
                                className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-50">{p.name}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <input type="number" min="1" value={item.quantity}
                        onChange={e => {
                          const items = [...form.items]; items[idx] = { ...items[idx], quantity: e.target.value }
                          setForm({ ...form, items })
                        }}
                        placeholder="Qtd" className="w-20 px-3 py-2 border rounded-md text-sm" />
                      <input type="number" step="0.01" min="0" value={item.unit_cost}
                        onChange={e => {
                          const items = [...form.items]; items[idx] = { ...items[idx], unit_cost: e.target.value }
                          setForm({ ...form, items })
                        }}
                        placeholder="R$ Custo" className="w-28 px-3 py-2 border rounded-md text-sm" />
                      {form.items.length > 1 && (
                        <button type="button" onClick={() => removeItem(idx)}
                          className="rounded p-2 text-gray-400 hover:bg-red-50 hover:text-red-600">
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addItem}
                  className="mt-2 text-sm text-blue-600 hover:underline">+ Adicionar item</button>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">Observações</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2} className="w-full px-3 py-2 border rounded-md text-sm resize-none" />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? 'Criando...' : 'Criar Pedido'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDetailPurchase(null)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Pedido #{detailPurchase.number}</h2>
              <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                (statusConfig[detailPurchase.status] ?? statusConfig.DRAFT).color)}>
                {(statusConfig[detailPurchase.status] ?? statusConfig.DRAFT).label}
              </span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Fornecedor</span>
                <span className="font-medium">{detailPurchase.supplier_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total</span>
                <span className="font-medium">{formatCurrency(detailPurchase.total_cents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Data Prevista</span>
                <span>{formatDate(detailPurchase.expected_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Criado em</span>
                <span>{formatDate(detailPurchase.created_at)}</span>
              </div>
              {detailPurchase.notes && (
                <div>
                  <span className="text-gray-500">Observações:</span>
                  <p className="mt-1 text-gray-700">{detailPurchase.notes}</p>
                </div>
              )}
              {detailPurchase.items && detailPurchase.items.length > 0 && (
                <div>
                  <span className="text-gray-500 mb-2 block">Itens:</span>
                  <div className="space-y-1">
                    {detailPurchase.items.map((item, i) => (
                      <div key={i} className="flex justify-between rounded bg-gray-50 px-3 py-2">
                        <span>{item.product_name}</span>
                        <span className="text-gray-500">{item.quantity} x {formatCurrency(item.unit_cost)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setDetailPurchase(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
