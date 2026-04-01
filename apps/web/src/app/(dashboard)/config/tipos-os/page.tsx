'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Save, Loader2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'

interface TipoOS {
  id?: string
  key: string
  label: string
}

export default function ConfigTiposOSPage() {
  const [tipos, setTipos] = useState<TipoOS[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')

  useEffect(() => {
    fetch('/api/settings/tipos-os')
      .then(r => r.json())
      .then(d => setTipos(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar tipos de OS'))
      .finally(() => setLoading(false))
  }, [])

  async function handleAdd() {
    if (!newLabel.trim()) { toast.error('Nome do tipo e obrigatorio'); return }
    const key = newKey.trim().toUpperCase().replace(/\s+/g, '_') || newLabel.trim().toUpperCase().replace(/\s+/g, '_')
    setSaving(true)
    try {
      const res = await fetch('/api/settings/tipos-os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, label: newLabel.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      setTipos(prev => [...prev, d.data])
      setNewKey('')
      setNewLabel('')
      toast.success('Tipo adicionado!')
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(tipo: TipoOS) {
    if (!confirm(`Remover tipo "${tipo.label}"?`)) return
    try {
      const res = await fetch('/api/settings/tipos-os', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: tipo.key }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      setTipos(prev => prev.filter(t => t.key !== tipo.key))
      toast.success('Tipo removido')
    } catch (err: any) { toast.error(err.message) }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tipos de OS</h1>
          <p className="text-sm text-gray-500">Balcao, Coleta, Campo, etc.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
        </div>
      ) : (
        <>
          {/* Lista atual */}
          <div className="rounded-lg border bg-white shadow-sm divide-y">
            {tipos.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-400 text-sm">Nenhum tipo cadastrado</div>
            ) : tipos.map(tipo => (
              <div key={tipo.key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-gray-300" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{tipo.label}</p>
                    <p className="text-xs text-gray-400 font-mono">{tipo.key}</p>
                  </div>
                </div>
                <button type="button" onClick={() => handleDelete(tipo)}
                  className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Adicionar novo */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Adicionar Tipo</h3>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Nome *</label>
                <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  placeholder="Ex: Campo, Remoto, Garantia..."
                  className="w-full px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
              <div className="w-32">
                <label className="block text-xs text-gray-500 mb-1">Codigo</label>
                <input type="text" value={newKey} onChange={e => setNewKey(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                  placeholder="Auto"
                  className="w-full px-3 py-2 border rounded-md text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
              <div className="flex items-end">
                <button type="button" onClick={handleAdd} disabled={saving || !newLabel.trim()}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Adicionar
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
