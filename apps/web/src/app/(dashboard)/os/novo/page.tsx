'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Cliente { id: string; legal_name: string; trade_name: string | null }

export default function NovaOSPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [searchCliente, setSearchCliente] = useState('')

  const [form, setForm] = useState({
    customer_id: '',
    equipment_type: 'Impressora',
    equipment_brand: '',
    equipment_model: '',
    serial_number: '',
    reported_issue: '',
    reception_notes: '',
    priority: 'MEDIUM',
    os_type: 'BALCAO',
  })

  // Buscar clientes
  useEffect(() => {
    if (searchCliente.length < 2) return
    const timer = setTimeout(() => {
      fetch(`/api/clientes?search=${encodeURIComponent(searchCliente)}&limit=10`)
        .then(r => r.json())
        .then(d => setClientes(d.data || []))
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [searchCliente])

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.customer_id) { toast.error('Selecione um cliente'); return }
    if (!form.reported_issue) { toast.error('Descreva o problema'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar OS')

      toast.success(`OS #${data.data.os_number} criada!`)
      router.push(`/os/${data.data.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar OS')
    } finally {
      setLoading(false)
    }
  }

  const selectedCliente = clientes.find(c => c.id === form.customer_id)

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Nova Ordem de Serviço</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cliente */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Cliente</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Buscar cliente</label>
            <input
              type="text"
              value={searchCliente}
              onChange={e => setSearchCliente(e.target.value)}
              placeholder="Digite o nome do cliente..."
              className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            {clientes.length > 0 && !form.customer_id && (
              <div className="mt-1 border rounded-md max-h-40 overflow-y-auto bg-white shadow-sm">
                {clientes.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setForm(p => ({...p, customer_id: c.id})); setSearchCliente(c.legal_name) }}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                  >
                    <span className="font-medium">{c.legal_name}</span>
                    {c.trade_name && <span className="text-gray-500 ml-2">({c.trade_name})</span>}
                  </button>
                ))}
              </div>
            )}
            {selectedCliente && (
              <p className="mt-1 text-sm text-green-600">✓ {selectedCliente.legal_name}</p>
            )}
          </div>
        </div>

        {/* Equipamento */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Equipamento</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tipo</label>
              <select value={form.equipment_type} onChange={e => updateForm('equipment_type', e.target.value)}
                className="w-full px-3 py-2 border rounded-md">
                <option>Impressora</option>
                <option>Notebook</option>
                <option>Monitor</option>
                <option>Scanner</option>
                <option>Outro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Marca</label>
              <input type="text" value={form.equipment_brand} onChange={e => updateForm('equipment_brand', e.target.value)}
                placeholder="HP, Epson, Brother..." className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Modelo</label>
              <input type="text" value={form.equipment_model} onChange={e => updateForm('equipment_model', e.target.value)}
                placeholder="LaserJet Pro M404" className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Nº Série</label>
              <input type="text" value={form.serial_number} onChange={e => updateForm('serial_number', e.target.value)}
                placeholder="VNC1234567" className="w-full px-3 py-2 border rounded-md" />
            </div>
          </div>
        </div>

        {/* Problema */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Problema</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Defeito relatado pelo cliente *</label>
            <textarea value={form.reported_issue} onChange={e => updateForm('reported_issue', e.target.value)}
              rows={3} placeholder="Descreva o problema..." required
              className="w-full px-3 py-2 border rounded-md resize-none" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Observações de recepção</label>
            <textarea value={form.reception_notes} onChange={e => updateForm('reception_notes', e.target.value)}
              rows={2} placeholder="Estado do equipamento na entrada..."
              className="w-full px-3 py-2 border rounded-md resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Prioridade</label>
              <select value={form.priority} onChange={e => updateForm('priority', e.target.value)}
                className="w-full px-3 py-2 border rounded-md">
                <option value="LOW">Baixa</option>
                <option value="MEDIUM">Média</option>
                <option value="HIGH">Alta</option>
                <option value="URGENT">Urgente</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tipo de OS</label>
              <select value={form.os_type} onChange={e => updateForm('os_type', e.target.value)}
                className="w-full px-3 py-2 border rounded-md">
                <option value="BALCAO">Balcão</option>
                <option value="COLETA">Coleta</option>
                <option value="ENTREGA">Entrega</option>
              </select>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">
            {loading ? 'Criando...' : 'Criar Ordem de Serviço'}
          </button>
        </div>
      </form>
    </div>
  )
}
