'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ArrowLeft, Layers, Plus, Trash2, Loader2, Edit, X, Save, Wrench, Package } from 'lucide-react'

interface KitItem {
  description: string
  unit_price: number
  quantity: number
  item_type: 'SERVICO' | 'PECA'
}

interface Kit {
  id: string
  key: string
  value: { name: string; items: KitItem[] }
  created_at: string
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function KitsPage() {
  const [kits, setKits] = useState<Kit[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [kitName, setKitName] = useState('')
  const [kitItems, setKitItems] = useState<KitItem[]>([])
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function loadKits() {
    fetch('/api/kits')
      .then(r => r.json())
      .then(d => setKits(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar kits'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadKits() }, [])

  function resetForm() {
    setKitName('')
    setKitItems([])
    setEditingId(null)
    setShowForm(false)
  }

  function openNewKit() {
    resetForm()
    setKitItems([{ description: '', unit_price: 0, quantity: 1, item_type: 'SERVICO' }])
    setShowForm(true)
  }

  function openEditKit(kit: Kit) {
    setEditingId(kit.id)
    setKitName(kit.value.name)
    setKitItems([...kit.value.items])
    setShowForm(true)
  }

  function addKitItem() {
    setKitItems([...kitItems, { description: '', unit_price: 0, quantity: 1, item_type: 'SERVICO' }])
  }

  function removeKitItem(idx: number) {
    setKitItems(kitItems.filter((_, i) => i !== idx))
  }

  function updateKitItem(idx: number, field: keyof KitItem, value: any) {
    const updated = [...kitItems]
    updated[idx] = { ...updated[idx], [field]: value }
    setKitItems(updated)
  }

  async function handleSave() {
    if (!kitName.trim()) { toast.error('Nome do kit e obrigatorio'); return }
    const validItems = kitItems.filter(i => i.description.trim())
    if (validItems.length === 0) { toast.error('Adicione pelo menos um item com descricao'); return }

    setSaving(true)
    try {
      const payload = {
        name: kitName.trim(),
        items: validItems.map(i => ({
          description: i.description.trim(),
          unit_price: Math.round(i.unit_price),
          quantity: i.quantity || 1,
          item_type: i.item_type,
        })),
      }

      let res: Response
      if (editingId) {
        res = await fetch(`/api/kits/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/kits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar kit')

      toast.success(editingId ? 'Kit atualizado!' : 'Kit criado!')
      resetForm()
      loadKits()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(kitId: string) {
    if (!confirm('Excluir este kit?')) return
    setDeletingId(kitId)
    try {
      const res = await fetch(`/api/kits/${kitId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Kit excluido')
      loadKits()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-2 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Kits de Servico</h1>
            <p className="text-sm text-gray-500">Kits pre-definidos para adicionar rapidamente na OS</p>
          </div>
        </div>
        {!showForm && (
          <button type="button" onClick={openNewKit}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 transition-colors shadow-sm">
            <Plus className="h-4 w-4" /> Novo Kit
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-xl border-2 border-purple-200 bg-purple-50/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {editingId ? 'Editar Kit' : 'Novo Kit'}
            </h2>
            <button type="button" onClick={resetForm} title="Cancelar" className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Kit *</label>
            <input type="text" value={kitName} onChange={e => setKitName(e.target.value)}
              placeholder="Ex: Manutencao preventiva impressora"
              className="w-full px-3 py-2.5 border rounded-lg text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-200" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Itens do Kit</label>
              <button type="button" onClick={addKitItem}
                className="flex items-center gap-1 text-xs font-medium text-purple-700 hover:text-purple-900">
                <Plus className="h-3.5 w-3.5" /> Adicionar item
              </button>
            </div>

            <div className="space-y-2">
              {kitItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 bg-white rounded-lg border p-3">
                  <div className="flex-1 grid grid-cols-12 gap-2">
                    <div className="col-span-5">
                      <label className="block text-xs text-gray-500 mb-0.5">Descricao</label>
                      <input type="text" value={item.description}
                        onChange={e => updateKitItem(idx, 'description', e.target.value)}
                        placeholder="Descricao do item"
                        className="w-full px-2 py-1.5 border rounded text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-0.5">Tipo</label>
                      <select value={item.item_type} title="Tipo do item"
                        onChange={e => updateKitItem(idx, 'item_type', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm bg-white">
                        <option value="SERVICO">Servico</option>
                        <option value="PECA">Peca</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-0.5">V.Unit (centavos)</label>
                      <input type="number" min="0" value={item.unit_price}
                        onChange={e => updateKitItem(idx, 'unit_price', parseInt(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 border rounded text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-0.5">Qtd</label>
                      <input type="number" min="1" value={item.quantity}
                        onChange={e => updateKitItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                        className="w-full px-2 py-1.5 border rounded text-sm" />
                    </div>
                    <div className="col-span-1 flex items-end justify-center pb-1">
                      {kitItems.length > 1 && (
                        <button type="button" onClick={() => removeKitItem(idx)} title="Remover item"
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {kitItems.length > 0 && (
              <div className="mt-2 text-right text-sm text-gray-600">
                Total estimado: <span className="font-semibold">
                  {fmt(kitItems.reduce((s, i) => s + (i.unit_price * (i.quantity || 1)), 0))}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={resetForm}
              className="px-4 py-2.5 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2 shadow-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Salvando...' : (editingId ? 'Salvar Alteracoes' : 'Criar Kit')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {kits.length === 0 && !showForm ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <Layers className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Nenhum kit cadastrado</p>
          <p className="text-gray-400 text-xs mt-1">Kits permitem adicionar varios itens de uma vez na OS</p>
          <button type="button" onClick={openNewKit}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 transition-colors">
            <Plus className="h-4 w-4" /> Criar primeiro kit
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kits.map(kit => {
            const data = kit.value
            const totalValue = data.items.reduce((s: number, i: KitItem) => s + (i.unit_price * (i.quantity || 1)), 0)
            const servicoCount = data.items.filter(i => i.item_type === 'SERVICO').length
            const pecaCount = data.items.filter(i => i.item_type === 'PECA').length

            return (
              <div key={kit.id} className="rounded-xl border bg-white p-4 shadow-sm hover:border-purple-200 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-purple-100">
                      <Layers className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{data.name}</h3>
                      <p className="text-xs text-gray-500">
                        {data.items.length} {data.items.length === 1 ? 'item' : 'itens'}
                        {servicoCount > 0 && <span> &middot; {servicoCount} <Wrench className="h-3 w-3 inline text-amber-500" /></span>}
                        {pecaCount > 0 && <span> &middot; {pecaCount} <Package className="h-3 w-3 inline text-blue-500" /></span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openEditKit(kit)} title="Editar"
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => handleDelete(kit.id)} title="Excluir"
                      disabled={deletingId === kit.id}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50">
                      {deletingId === kit.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Items preview */}
                <div className="space-y-1 mb-3">
                  {data.items.slice(0, 4).map((item: KitItem, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-xs text-gray-600">
                      <span className="truncate flex-1 mr-2">
                        {item.item_type === 'SERVICO' ? (
                          <Wrench className="h-3 w-3 inline mr-1 text-amber-400" />
                        ) : (
                          <Package className="h-3 w-3 inline mr-1 text-blue-400" />
                        )}
                        {item.description}
                      </span>
                      <span className="text-gray-400 whitespace-nowrap">
                        {item.quantity > 1 ? `${item.quantity}x ` : ''}{fmt(item.unit_price)}
                      </span>
                    </div>
                  ))}
                  {data.items.length > 4 && (
                    <p className="text-xs text-gray-400">+{data.items.length - 4} mais...</p>
                  )}
                </div>

                <div className="border-t pt-2 text-right">
                  <span className="text-sm font-semibold text-purple-700">{fmt(totalValue)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
