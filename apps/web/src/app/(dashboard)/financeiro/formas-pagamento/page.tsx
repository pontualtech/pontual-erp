'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X, Loader2, ArrowLeft, CreditCard } from 'lucide-react'
import Link from 'next/link'

interface FormaPgto { id: string; name: string; icon: string; active: boolean }

const ICON_OPTIONS = ['💵', '📱', '💳', '📄', '🏦', '📝', '🤝', '💰', '🪙', '💲', '🔄', '📲']

export default function FormasPagamentoPage() {
  const [items, setItems] = useState<FormaPgto[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<FormaPgto | null>(null)
  const [formName, setFormName] = useState('')
  const [formIcon, setFormIcon] = useState('💰')
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/financeiro/formas-pagamento')
      .then(r => r.json())
      .then(d => setItems(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  function openCreate() { setEditing(null); setFormName(''); setFormIcon('💰'); setFormActive(true); setShowModal(true) }
  function openEdit(f: FormaPgto) { setEditing(f); setFormName(f.name); setFormIcon(f.icon); setFormActive(f.active); setShowModal(true) }

  async function handleSave() {
    if (!formName.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/financeiro/formas-pagamento/${editing.id}` : '/api/financeiro/formas-pagamento'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), icon: formIcon, active: formActive }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success(editing ? 'Forma atualizada!' : 'Forma criada!')
      setShowModal(false); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/formas-pagamento/${deleteId}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Forma excluída'); setDeleteId(null); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  const toDelete = items.find(i => i.id === deleteId)

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Formas de Pagamento</h1>
            <p className="text-sm text-gray-500">Usadas na entrega de OS e lançamentos financeiros</p>
          </div>
        </div>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Nova Forma
        </button>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        {loading ? (
          <div className="px-4 py-8 text-center text-gray-400">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-400">
            <CreditCard className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>Nenhuma forma de pagamento cadastrada</p>
            <p className="text-sm mt-1">Clique em "Nova Forma" para adicionar</p>
          </div>
        ) : (
          <div className="divide-y">
            {items.map(f => (
              <div key={f.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 group">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{f.icon}</span>
                  <div>
                    <span className="font-medium text-gray-900">{f.name}</span>
                    {!f.active && (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Inativa</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" onClick={() => openEdit(f)} title="Editar"
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setDeleteId(f.id)} title="Excluir"
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editing ? 'Editar Forma' : 'Nova Forma de Pagamento'}</h2>
              <button type="button" onClick={() => setShowModal(false)} title="Fechar" className="p-1 rounded hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: PIX, Cartão Crédito, Boleto..."
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Ícone</label>
                <div className="flex flex-wrap gap-2">
                  {ICON_OPTIONS.map(ic => (
                    <button key={ic} type="button" onClick={() => setFormIcon(ic)} title={ic}
                      className={`h-10 w-10 rounded-md border-2 text-xl flex items-center justify-center transition-colors ${
                        formIcon === ic ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>{ic}</button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formActive} onChange={e => setFormActive(e.target.checked)}
                  title="Ativa" className="rounded text-blue-600" />
                <span className="text-sm">Forma de pagamento ativa</span>
              </label>
              <div className="border-t pt-3">
                <p className="text-xs text-gray-500">Preview:</p>
                <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-md border bg-gray-50">
                  <span className="text-xl">{formIcon}</span>
                  <span className="text-sm font-medium">{formName || 'Nome da forma'}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Excluir forma de pagamento?</h2>
            <p className="text-sm text-gray-600 mb-4">Tem certeza que deseja excluir <strong>{toDelete?.icon} {toDelete?.name}</strong>?</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
