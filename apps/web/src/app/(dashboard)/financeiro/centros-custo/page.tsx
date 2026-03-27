'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X, Loader2, ArrowLeft, Search } from 'lucide-react'
import Link from 'next/link'

interface CentroCusto { id: string; name: string; is_active: boolean }

export default function CentrosCustoPage() {
  const [items, setItems] = useState<CentroCusto[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<CentroCusto | null>(null)
  const [formName, setFormName] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/financeiro/centros-custo')
      .then(r => r.json())
      .then(d => setItems(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  function openCreate() { setEditing(null); setFormName(''); setFormActive(true); setShowModal(true) }
  function openEdit(c: CentroCusto) {
    setEditing(c); setFormName(c.name); setFormActive(c.is_active)
    setShowModal(true)
  }

  async function handleSave() {
    if (!formName.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/financeiro/centros-custo/${editing.id}` : '/api/financeiro/centros-custo'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), is_active: formActive }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success(editing ? 'Centro de custo atualizado!' : 'Centro de custo criado!')
      setShowModal(false); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/centros-custo/${deleteId}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Centro de custo excluído'); setDeleteId(null); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  )
  const toDelete = items.find(i => i.id === deleteId)

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold text-gray-900">Centros de Custo</h1>
        </div>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Novo Centro de Custo
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar centro de custo..."
          className="w-full pl-9 pr-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-sm" />
      </div>

      {loading ? <div className="py-8 text-center text-gray-400">Carregando...</div> : (
        <div className="space-y-4">
          {filtered.length > 0 ? (
            <div className="rounded-lg border bg-white overflow-hidden">
              <div className="divide-y">
                {filtered.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 group">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-900">{c.name}</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>{c.is_active ? 'Ativo' : 'Inativo'}</span>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => openEdit(c)} title="Editar"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setDeleteId(c.id)} title="Excluir"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-gray-400">
              {search ? 'Nenhum centro de custo encontrado' : 'Nenhum centro de custo cadastrado'}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editing ? 'Editar Centro de Custo' : 'Novo Centro de Custo'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: Administrativo, Comercial, Operacional..."
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" autoFocus />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="formActive" checked={formActive} onChange={e => setFormActive(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <label htmlFor="formActive" className="text-sm font-medium text-gray-700">Ativo</label>
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
            <h2 className="text-lg font-semibold mb-2">Excluir centro de custo?</h2>
            <p className="text-sm text-gray-600 mb-4">Tem certeza que deseja excluir <strong>{toDelete?.name}</strong>?</p>
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
