'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Loader2, GripVertical, Monitor } from 'lucide-react'
import { toast } from 'sonner'

export default function ConfigEquipamentosOSPage() {
  const [items, setItems] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    fetch('/api/settings/equipamentos-os')
      .then(r => r.json())
      .then(d => setItems(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [])

  async function handleAdd() {
    if (!newName.trim()) { toast.error('Nome obrigatorio'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/settings/equipamentos-os', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      setItems(prev => [...prev, newName.trim()])
      setNewName('')
      toast.success('Adicionado!')
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Remover "${name}"?`)) return
    try {
      const res = await fetch('/api/settings/equipamentos-os', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      setItems(prev => prev.filter(i => i !== name))
      toast.success('Removido')
    } catch (err: any) { toast.error(err.message) }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Monitor className="h-6 w-6" /> Tipos de Equipamento
          </h1>
          <p className="text-sm text-gray-500">Impressora, Notebook, Termica, etc.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
        </div>
      ) : (
        <>
          <div className="rounded-lg border bg-white shadow-sm divide-y">
            {items.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-400 text-sm">Nenhum tipo cadastrado</div>
            ) : items.map(name => (
              <div key={name} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <GripVertical className="h-4 w-4 text-gray-300" />
                  <p className="text-sm font-medium text-gray-900">{name}</p>
                </div>
                <button type="button" onClick={() => handleDelete(name)}
                  className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Adicionar Tipo de Equipamento</h3>
            <div className="flex gap-3">
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Ex: Plotter, Copiadora, Desktop..."
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                className="flex-1 px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              <button type="button" onClick={handleAdd} disabled={saving || !newName.trim()}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Adicionar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
