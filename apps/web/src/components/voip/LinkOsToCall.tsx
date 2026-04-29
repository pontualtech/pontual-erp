'use client'

import { useEffect, useState } from 'react'
import { Link2, X, Check, Loader2 } from 'lucide-react'

interface ServiceOrderOption {
  id: string
  os_number: number
  equipment_type: string
  equipment_brand: string | null
  equipment_model: string | null
  status: { name: string } | null
}

interface Props {
  callId: string
  customerId: string | null
  currentOsId: string | null
  onChange?: () => void
  mode: 'link' | 'change'
}

export function LinkOsToCall({ callId, customerId, currentOsId, onChange, mode }: Props) {
  const [open, setOpen] = useState(false)
  const [orders, setOrders] = useState<ServiceOrderOption[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<string>(currentOsId || '')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !customerId) return
    setLoading(true)
    setError('')
    const url = new URL('/api/os', window.location.origin)
    url.searchParams.set('customerId', customerId)
    url.searchParams.set('limit', '50')
    fetch(url.toString())
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(typeof d.error === 'string' ? d.error : 'Erro ao listar OS'); return }
        setOrders(d.data ?? [])
      })
      .catch(() => setError('Erro ao listar OS'))
      .finally(() => setLoading(false))
  }, [open, customerId])

  async function save(osId: string | null) {
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`/api/voip/calls/${callId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_order_id: osId }),
      })
      const d = await r.json()
      if (!r.ok) { setError(typeof d.error === 'string' ? d.error : 'Falha ao vincular'); return }
      setOpen(false)
      onChange?.()
    } catch {
      setError('Erro de rede')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border rounded-md hover:bg-gray-50"
      >
        <Link2 className="h-4 w-4" />
        {mode === 'link' ? 'Vincular OS' : 'Trocar OS'}
      </button>
    )
  }

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          disabled={loading || saving}
          aria-label="Selecionar OS"
          className="flex-1 px-3 py-1.5 text-sm border rounded-md disabled:opacity-50"
        >
          <option value="">— Selecione uma OS —</option>
          {orders.map(o => (
            <option key={o.id} value={o.id}>
              #{o.os_number} · {o.equipment_type}
              {o.equipment_brand ? ` (${o.equipment_brand}${o.equipment_model ? ' ' + o.equipment_model : ''})` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => save(selected || null)}
          disabled={saving || (mode === 'link' && !selected)}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Salvar
        </button>
        {currentOsId && (
          <button
            type="button"
            onClick={() => save(null)}
            disabled={saving}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
            title="Desvincular OS"
          >
            Desvincular
          </button>
        )}
        <button
          type="button"
          onClick={() => { setOpen(false); setSelected(currentOsId || ''); setError('') }}
          className="p-1.5 hover:bg-gray-100 rounded-md"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {loading && <div className="text-xs text-gray-500">Carregando OS do cliente…</div>}
      {!loading && orders.length === 0 && customerId && (
        <div className="text-xs text-gray-500 italic">Nenhuma OS encontrada para este cliente.</div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  )
}
