'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, GripVertical, Star, Flag, Loader2, X, ArrowUp, ArrowDown } from 'lucide-react'

interface Status {
  id: string
  name: string
  color: string
  order: number
  is_default: boolean
  is_final: boolean
  module: string
}

const PRESET_COLORS = [
  '#3B82F6', '#7C3AED', '#8B5CF6', '#A855F7',
  '#F59E0B', '#F97316', '#EA580C', '#EF4444',
  '#DC2626', '#10B981', '#16A34A', '#22C55E',
  '#06B6D4', '#0891B2', '#6366F1', '#EC4899',
  '#14B8A6', '#84CC16', '#6B7280', '#1F2937',
]

export default function StatusPage() {
  const [statuses, setStatuses] = useState<Status[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingStatus, setEditingStatus] = useState<Status | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)

  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState('#3B82F6')
  const [formIsFinal, setFormIsFinal] = useState(false)
  const [formIsDefault, setFormIsDefault] = useState(false)

  function loadStatuses() {
    setLoading(true)
    fetch('/api/status?module=os')
      .then(r => r.json())
      .then(d => setStatuses(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar status'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadStatuses() }, [])

  function openCreate() {
    setEditingStatus(null)
    setFormName('')
    setFormColor('#3B82F6')
    setFormIsFinal(false)
    setFormIsDefault(false)
    setShowModal(true)
  }

  function openEdit(s: Status) {
    setEditingStatus(s)
    setFormName(s.name)
    setFormColor(s.color)
    setFormIsFinal(s.is_final)
    setFormIsDefault(s.is_default)
    setShowModal(true)
  }

  async function handleSave() {
    if (!formName.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        color: formColor,
        is_final: formIsFinal,
        is_default: formIsDefault,
        module: 'os',
        order: editingStatus ? editingStatus.order : (statuses.length + 1),
      }

      const url = editingStatus ? `/api/status/${editingStatus.id}` : '/api/status'
      const method = editingStatus ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')

      toast.success(editingStatus ? 'Status atualizado!' : 'Status criado!')
      setShowModal(false)
      loadStatuses()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/status/${deleteId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir')
      toast.success('Status excluído')
      setDeleteId(null)
      loadStatuses()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setDeleting(false)
    }
  }

  async function moveStatus(id: string, direction: 'up' | 'down') {
    const idx = statuses.findIndex(s => s.id === id)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= statuses.length) return

    const a = statuses[idx]
    const b = statuses[swapIdx]

    // Swap orders
    await Promise.all([
      fetch(`/api/status/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: b.order }),
      }),
      fetch(`/api/status/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: a.order }),
      }),
    ])

    loadStatuses()
  }

  const statusToDelete = statuses.find(s => s.id === deleteId)

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Status de OS</h1>
          <p className="text-sm text-gray-500 mt-1">Gerencie os status do fluxo de ordens de serviço</p>
        </div>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Novo Status
        </button>
      </div>

      {/* Status list */}
      <div className="rounded-lg border bg-white shadow-sm">
        {loading ? (
          <div className="px-4 py-8 text-center text-gray-400">Carregando...</div>
        ) : statuses.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-400">Nenhum status configurado</div>
        ) : (
          <div className="divide-y">
            {statuses.map((s, idx) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 group">
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5">
                  <button type="button" onClick={() => moveStatus(s.id, 'up')} disabled={idx === 0} title="Mover para cima"
                    className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-20 text-gray-400">
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={() => moveStatus(s.id, 'down')} disabled={idx === statuses.length - 1} title="Mover para baixo"
                    className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-20 text-gray-400">
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>

                {/* Color dot */}
                <span className="h-5 w-5 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                  style={{ backgroundColor: s.color }} />

                {/* Name + badges */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{s.name}</span>
                    {s.is_default && (
                      <span className="flex items-center gap-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        <Star className="h-3 w-3" /> Padrão
                      </span>
                    )}
                    {s.is_final && (
                      <span className="flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <Flag className="h-3 w-3" /> Final
                      </span>
                    )}
                  </div>
                </div>

                {/* Order number */}
                <span className="text-xs text-gray-400 font-mono w-6 text-right">{s.order}</span>

                {/* Action buttons */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" onClick={() => openEdit(s)} title="Editar"
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-amber-600">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setDeleteId(s.id)} title="Excluir"
                    disabled={s.is_default}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Star className="h-3 w-3 text-blue-500" /> Padrão = status inicial ao criar OS</span>
        <span className="flex items-center gap-1"><Flag className="h-3 w-3 text-green-500" /> Final = OS encerrada (entregue, cancelada)</span>
      </div>

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingStatus ? 'Editar Status' : 'Novo Status'}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Status *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: Em Análise, Aguardando Peça..."
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" autoFocus />
              </div>

              {/* Color picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cor</label>
                <div className="flex items-center gap-3 mb-2">
                  <span className="h-10 w-10 rounded-lg border-2 shadow-sm" style={{ backgroundColor: formColor }} />
                  <input type="text" value={formColor} onChange={e => setFormColor(e.target.value)}
                    placeholder="#3B82F6"
                    className="w-28 px-2 py-1.5 border rounded-md font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setFormColor(c)} title={c}
                      className={`h-7 w-7 rounded-md border-2 transition-transform hover:scale-110 ${formColor === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>

              {/* Flags */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formIsDefault} onChange={e => setFormIsDefault(e.target.checked)}
                    className="rounded text-blue-600" title="Status padrão" />
                  <span className="text-sm">Status padrão (inicial)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formIsFinal} onChange={e => setFormIsFinal(e.target.checked)}
                    className="rounded text-blue-600" title="Status final" />
                  <span className="text-sm">Status final</span>
                </label>
              </div>

              {/* Preview */}
              <div className="border-t pt-3">
                <p className="text-xs text-gray-500 mb-2">Preview:</p>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-white"
                  style={{ backgroundColor: formColor }}>
                  {formName || 'Nome do status'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? 'Salvando...' : editingStatus ? 'Salvar' : 'Criar Status'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Excluir status?</h2>
            <p className="text-sm text-gray-600 mb-1">
              Tem certeza que deseja excluir <strong>{statusToDelete?.name}</strong>?
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Só é possível excluir status que não possuem OS vinculadas.
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
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
