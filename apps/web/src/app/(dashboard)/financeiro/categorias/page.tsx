'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X, Loader2, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react'
import Link from 'next/link'

interface Categoria { id: string; name: string; module: string; parent_id: string | null; order: number }

export default function CategoriasPage() {
  const [items, setItems] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<'' | 'RECEITA' | 'DESPESA'>('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Categoria | null>(null)
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<'RECEITA' | 'DESPESA'>('DESPESA')
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function load() {
    setLoading(true)
    const params = filtro ? `?type=${filtro}` : ''
    fetch(`/api/financeiro/categorias${params}`)
      .then(r => r.json())
      .then(d => setItems(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [filtro])

  function openCreate() { setEditing(null); setFormName(''); setFormType('DESPESA'); setShowModal(true) }
  function openEdit(c: Categoria) {
    setEditing(c); setFormName(c.name)
    setFormType(c.module === 'financeiro_receita' ? 'RECEITA' : 'DESPESA')
    setShowModal(true)
  }

  async function handleSave() {
    if (!formName.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/financeiro/categorias/${editing.id}` : '/api/financeiro/categorias'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), type: formType }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success(editing ? 'Categoria atualizada!' : 'Categoria criada!')
      setShowModal(false); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/categorias/${deleteId}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Categoria excluída'); setDeleteId(null); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  const receitas = items.filter(i => i.module === 'financeiro_receita')
  const despesas = items.filter(i => i.module === 'financeiro_despesa')
  const toDelete = items.find(i => i.id === deleteId)

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold text-gray-900">Categorias Financeiras</h1>
        </div>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Nova Categoria
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-md border bg-white p-0.5 w-fit">
        {([['', 'Todas'], ['RECEITA', 'Receitas'], ['DESPESA', 'Despesas']] as const).map(([val, label]) => (
          <button key={val} type="button" onClick={() => setFiltro(val as any)}
            className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
              filtro === val ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}>{label}</button>
        ))}
      </div>

      {loading ? <div className="py-8 text-center text-gray-400">Carregando...</div> : (
        <div className="space-y-4">
          {/* Receitas */}
          {(filtro === '' || filtro === 'RECEITA') && receitas.length > 0 && (
            <div className="rounded-lg border bg-white overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border-b">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span className="font-medium text-green-800 text-sm">Receitas ({receitas.length})</span>
              </div>
              <div className="divide-y">
                {receitas.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 group">
                    <span className="text-sm text-gray-900">{c.name}</span>
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
          )}

          {/* Despesas */}
          {(filtro === '' || filtro === 'DESPESA') && despesas.length > 0 && (
            <div className="rounded-lg border bg-white overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border-b">
                <TrendingDown className="h-4 w-4 text-red-600" />
                <span className="font-medium text-red-800 text-sm">Despesas ({despesas.length})</span>
              </div>
              <div className="divide-y">
                {despesas.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 group">
                    <span className="text-sm text-gray-900">{c.name}</span>
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
          )}

          {items.length === 0 && <div className="py-8 text-center text-gray-400">Nenhuma categoria cadastrada</div>}
        </div>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editing ? 'Editar Categoria' : 'Nova Categoria'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="flex gap-3">
                <button type="button" onClick={() => setFormType('RECEITA')}
                  className={`flex-1 py-2.5 rounded-md text-sm font-medium border-2 transition-colors flex items-center justify-center gap-1.5 ${
                    formType === 'RECEITA' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500'
                  }`}><TrendingUp className="h-4 w-4" /> Receita</button>
                <button type="button" onClick={() => setFormType('DESPESA')}
                  className={`flex-1 py-2.5 rounded-md text-sm font-medium border-2 transition-colors flex items-center justify-center gap-1.5 ${
                    formType === 'DESPESA' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500'
                  }`}><TrendingDown className="h-4 w-4" /> Despesa</button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da categoria *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: Venda de Serviços, Aluguel..."
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" autoFocus />
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
            <h2 className="text-lg font-semibold mb-2">Excluir categoria?</h2>
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
