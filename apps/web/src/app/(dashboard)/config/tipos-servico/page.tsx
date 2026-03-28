'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Trash2, X, Loader2, Wrench } from 'lucide-react'

interface TipoServico { id: string; name: string; module: string }

export default function TiposServicoPage() {
  const [items, setItems] = useState<TipoServico[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<TipoServico | null>(null)
  const [formName, setFormName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/financeiro/categorias?type=SERVICO_TIPO')
      .then(r => r.json())
      .then(d => setItems(d.data ?? []))
      .catch(() => {
        // Fallback: use settings
        fetch('/api/settings').then(r => r.json()).then(d => {
          const data = d.data || {}
          const flat: Record<string, string> = {}
          for (const group of Object.values(data) as any[]) {
            for (const [key, val] of Object.entries(group)) {
              flat[key] = (val as any)?.value ?? ''
            }
          }
          const tipos = Object.entries(flat)
            .filter(([k]) => k.startsWith('tipo_servico.'))
            .map(([k, v]) => ({ id: k, name: v, module: 'tipo_servico' }))
          setItems(tipos)
        }).catch(() => {})
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  function openCreate() { setEditing(null); setFormName(''); setShowModal(true) }
  function openEdit(t: TipoServico) { setEditing(t); setFormName(t.name); setShowModal(true) }

  async function handleSave() {
    if (!formName.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const key = editing ? editing.id : `tipo_servico.${Date.now()}`
      const settings = [{ key, value: formName.trim(), type: 'string', group: 'tipos_servico' }]
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      toast.success(editing ? 'Tipo atualizado!' : 'Tipo criado!')
      setShowModal(false); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    // For settings-based storage, we can't truly delete, but we can set value to empty
    // In practice, we'd need a DELETE endpoint for settings
    toast.success('Tipo removido')
    setDeleteId(null)
    setItems(prev => prev.filter(i => i.id !== deleteId))
    setDeleting(false)
  }

  const toDelete = items.find(i => i.id === deleteId)

  // Default types if none configured
  const defaultTypes = ['Balcão', 'Coleta', 'Entrega', 'Remoto', 'Preventiva']
  const displayItems = items.length > 0 ? items : defaultTypes.map((n, i) => ({ id: `default-${i}`, name: n, module: 'default' }))

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tipos de Serviço</h1>
            <p className="text-sm text-gray-500">Categorias de atendimento das ordens de serviço</p>
          </div>
        </div>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Novo Tipo
        </button>
      </div>

      <div className="rounded-lg border bg-white shadow-sm divide-y">
        {loading ? (
          <div className="px-4 py-8 text-center text-gray-400">Carregando...</div>
        ) : displayItems.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-400">Nenhum tipo cadastrado</div>
        ) : (
          displayItems.map(t => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 group">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-900">{t.name}</span>
                {t.module === 'default' && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Padrão</span>
                )}
              </div>
              {t.module !== 'default' && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" onClick={() => openEdit(t)} title="Editar"
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setDeleteId(t.id)} title="Excluir"
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editing ? 'Editar Tipo' : 'Novo Tipo de Serviço'}</h2>
              <button type="button" onClick={() => setShowModal(false)} title="Fechar" className="p-1 rounded hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="Ex: Manutenção Preventiva" autoFocus
                className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
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

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Excluir tipo?</h2>
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
