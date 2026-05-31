'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X, Loader2, ArrowLeft, TrendingUp, TrendingDown, Package, Briefcase } from 'lucide-react'
import Link from 'next/link'
import { CATEGORY_TYPES, MODULE_TO_TYPE, TYPE_LABELS, type CategoryType } from '@/lib/category-types'

interface Categoria { id: string; name: string; module: string; parent_id: string | null; order: number }

const TYPE_META: Record<CategoryType, { color: string; bg: string; border: string; text: string; icon: typeof TrendingUp }> = {
  RECEITA:       { color: 'green',  bg: 'bg-green-50',   border: 'border-green-500',   text: 'text-green-700',   icon: TrendingUp },
  CUSTO:         { color: 'orange', bg: 'bg-orange-50',  border: 'border-orange-500',  text: 'text-orange-700',  icon: Package },
  DESPESA:       { color: 'red',    bg: 'bg-red-50',     border: 'border-red-500',     text: 'text-red-700',     icon: TrendingDown },
  INVESTIMENTO:  { color: 'purple', bg: 'bg-purple-50',  border: 'border-purple-500',  text: 'text-purple-700',  icon: Briefcase },
}

type Filtro = '' | CategoryType

export default function CategoriasPage() {
  const [items, setItems] = useState<Categoria[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Categoria | null>(null)
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<CategoryType>('DESPESA')
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
    setFormType(MODULE_TO_TYPE[c.module] || 'DESPESA')
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

  const toDelete = items.find(i => i.id === deleteId)
  // Agrupado por tipo via MODULE_TO_TYPE
  const grouped: Record<CategoryType, Categoria[]> = { RECEITA: [], CUSTO: [], DESPESA: [], INVESTIMENTO: [] }
  for (const c of items) {
    const t = MODULE_TO_TYPE[c.module] || 'DESPESA'
    grouped[t].push(c)
  }

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
      <div className="flex flex-wrap gap-1 rounded-md border bg-white p-0.5 w-fit">
        <button type="button" onClick={() => setFiltro('')}
          className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${filtro === '' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>Todas</button>
        {CATEGORY_TYPES.map(t => (
          <button key={t} type="button" onClick={() => setFiltro(t)}
            className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
              filtro === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}>{TYPE_LABELS[t]}</button>
        ))}
      </div>

      {loading ? <div className="py-8 text-center text-gray-400">Carregando...</div> : (
        <div className="space-y-4">
          {CATEGORY_TYPES.map(t => {
            const list = grouped[t]
            const visible = (filtro === '' || filtro === t) && list.length > 0
            if (!visible) return null
            const meta = TYPE_META[t]
            const Icon = meta.icon
            return (
              <div key={t} className="rounded-lg border bg-white overflow-hidden">
                <div className={`flex items-center gap-2 px-4 py-2.5 ${meta.bg} border-b`}>
                  <Icon className={`h-4 w-4 ${meta.text}`} />
                  <span className={`font-medium text-sm ${meta.text}`}>{TYPE_LABELS[t]} ({list.length})</span>
                </div>
                <div className="divide-y">
                  {list.map(c => (
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
            )
          })}

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
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Tipo</p>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORY_TYPES.map(t => {
                    const meta = TYPE_META[t]
                    const Icon = meta.icon
                    const active = formType === t
                    return (
                      <button key={t} type="button" onClick={() => setFormType(t)}
                        className={`py-2.5 rounded-md text-xs font-medium border-2 transition-colors flex items-center justify-center gap-1.5 ${
                          active ? `${meta.border} ${meta.bg} ${meta.text}` : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}><Icon className="h-3.5 w-3.5" /> {TYPE_LABELS[t]}</button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  <strong>Receita</strong>: vendas/serviços · <strong>Custo</strong>: CMV/CPV (vinculado a receita) · <strong>Despesa</strong>: operacional · <strong>Investimento</strong>: capex
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da categoria *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: Venda de Serviços, Peças vendidas..."
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
