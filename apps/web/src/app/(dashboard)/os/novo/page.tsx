'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'

interface Cliente { id: string; legal_name: string; trade_name: string | null }

export default function NovaOSPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [searchCliente, setSearchCliente] = useState('')
  const [showNovoCliente, setShowNovoCliente] = useState(false)

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
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Cliente</h2>
            <button
              type="button"
              onClick={() => setShowNovoCliente(true)}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              <Plus className="h-4 w-4" /> Novo Cliente
            </button>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Buscar cliente</label>
            <input
              type="text"
              value={searchCliente}
              onChange={e => { setSearchCliente(e.target.value); setForm(p => ({...p, customer_id: ''})) }}
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

      {/* Modal Novo Cliente */}
      {showNovoCliente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowNovoCliente(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Cadastro Rápido de Cliente</h2>
              <button type="button" onClick={() => setShowNovoCliente(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NovoClienteForm onCreated={(cliente) => {
              setForm(p => ({ ...p, customer_id: cliente.id }))
              setSearchCliente(cliente.legal_name)
              setClientes([cliente])
              setShowNovoCliente(false)
              toast.success('Cliente cadastrado!')
            }} />
          </div>
        </div>
      )}
    </div>
  )
}

function NovoClienteForm({ onCreated }: { onCreated: (c: Cliente) => void }) {
  const [saving, setSaving] = useState(false)
  const [personType, setPersonType] = useState('FISICA')
  const [clienteForm, setClienteForm] = useState({
    legal_name: '',
    trade_name: '',
    person_type: 'FISICA',
    customer_type: 'CLIENTE',
    document_number: '',
    email: '',
    phone: '',
    mobile: '',
    address_city: 'São Paulo',
    address_state: 'SP',
  })

  function update(field: string, value: string) {
    setClienteForm(prev => ({ ...prev, [field]: value }))
    if (field === 'person_type') setPersonType(value)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clienteForm.legal_name) { toast.error('Nome é obrigatório'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clienteForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')
      onCreated(data.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="radio" name="pt" value="FISICA" checked={personType === 'FISICA'} onChange={e => update('person_type', e.target.value)} />
          Pessoa Física
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="radio" name="pt" value="JURIDICA" checked={personType === 'JURIDICA'} onChange={e => update('person_type', e.target.value)} />
          Pessoa Jurídica
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {personType === 'FISICA' ? 'Nome completo *' : 'Razão Social *'}
        </label>
        <input type="text" value={clienteForm.legal_name} onChange={e => update('legal_name', e.target.value)}
          required className="w-full px-3 py-2 border rounded-md text-sm" />
      </div>

      {personType === 'JURIDICA' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome Fantasia</label>
          <input type="text" value={clienteForm.trade_name} onChange={e => update('trade_name', e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm" />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{personType === 'FISICA' ? 'CPF' : 'CNPJ'}</label>
        <input type="text" value={clienteForm.document_number} onChange={e => update('document_number', e.target.value)}
          placeholder={personType === 'FISICA' ? '000.000.000-00' : '00.000.000/0001-00'}
          className="w-full px-3 py-2 border rounded-md text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Celular</label>
          <input type="tel" value={clienteForm.mobile} onChange={e => update('mobile', e.target.value)}
            placeholder="(11) 99999-0000" className="w-full px-3 py-2 border rounded-md text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={clienteForm.email} onChange={e => update('email', e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm" />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving}
          className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
          {saving ? 'Salvando...' : 'Cadastrar e Selecionar'}
        </button>
      </div>
    </form>
  )
}
