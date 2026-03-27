'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, X, Search, Loader2, CheckCircle, Building2, User } from 'lucide-react'

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

// ── Masks ──────────────────────────────────────
function maskCPF(v: string) {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}
function maskCNPJ(v: string) {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}
function maskCEP(v: string) {
  return v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}
function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

function NovoClienteForm({ onCreated }: { onCreated: (c: Cliente) => void }) {
  const [saving, setSaving] = useState(false)
  const [docStatus, setDocStatus] = useState<'idle' | 'searching' | 'found' | 'cnpj-filled' | 'not-found' | 'error'>('idle')
  const [docMessage, setDocMessage] = useState('')
  const [existingClientId, setExistingClientId] = useState<string | null>(null)
  const [cepLoading, setCepLoading] = useState(false)

  const [f, setF] = useState({
    legal_name: '', trade_name: '', person_type: 'FISICA', customer_type: 'CLIENTE',
    document_number: '', email: '', phone: '', mobile: '',
    address_zip: '', address_street: '', address_number: '', address_complement: '',
    address_neighborhood: '', address_city: '', address_state: '',
  })

  function update(field: string, value: string) { setF(prev => ({ ...prev, [field]: value })) }

  const handleDocChange = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '')
    const masked = digits.length <= 11 ? maskCPF(value) : maskCNPJ(value)
    setF(prev => ({ ...prev, document_number: masked, person_type: digits.length <= 11 ? 'FISICA' : 'JURIDICA' }))
    setDocStatus('idle'); setDocMessage(''); setExistingClientId(null)
  }, [])

  async function searchDoc() {
    const digits = f.document_number.replace(/\D/g, '')
    if (digits.length < 11) { toast.error('CPF ou CNPJ incompleto'); return }
    setDocStatus('searching'); setDocMessage('Consultando...')
    try {
      const existRes = await fetch(`/api/clientes/por-documento/${digits}`)
      const existData = await existRes.json()
      if (existData.data) {
        const c = existData.data
        setF({
          legal_name: c.legal_name || '', trade_name: c.trade_name || '',
          person_type: c.person_type === 'JURIDICA' ? 'JURIDICA' : 'FISICA',
          customer_type: c.customer_type || 'CLIENTE', document_number: f.document_number,
          email: c.email || '', phone: c.phone ? maskPhone(c.phone) : '', mobile: c.mobile ? maskPhone(c.mobile) : '',
          address_zip: c.address_zip ? maskCEP(c.address_zip) : '',
          address_street: c.address_street || '', address_number: c.address_number || '',
          address_complement: c.address_complement || '', address_neighborhood: c.address_neighborhood || '',
          address_city: c.address_city || '', address_state: c.address_state || '',
        })
        setExistingClientId(c.id)
        setDocStatus('found'); setDocMessage(`Cliente existente: ${c.legal_name}`)
        toast.info('Cliente encontrado! Pode editar e salvar.')
        return
      }
      if (digits.length === 14) {
        const cnpjRes = await fetch(`/api/consulta/cnpj/${digits}`)
        const cnpjData = await cnpjRes.json()
        if (cnpjRes.ok && cnpjData.data) {
          const d = cnpjData.data
          setF(prev => ({
            ...prev, person_type: 'JURIDICA',
            legal_name: d.legal_name || prev.legal_name, trade_name: d.trade_name || prev.trade_name,
            email: d.email || prev.email, phone: d.phone ? maskPhone(d.phone) : prev.phone,
            address_street: d.address_street || prev.address_street, address_number: d.address_number || prev.address_number,
            address_complement: d.address_complement || prev.address_complement,
            address_neighborhood: d.address_neighborhood || prev.address_neighborhood,
            address_city: d.address_city || prev.address_city, address_state: d.address_state || prev.address_state,
            address_zip: d.address_zip ? maskCEP(d.address_zip) : prev.address_zip,
          }))
          setDocStatus('cnpj-filled'); setDocMessage(d.situacao || 'Dados preenchidos')
          toast.success('Dados da Receita Federal preenchidos!')
          return
        }
      }
      setDocStatus('not-found'); setDocMessage('Novo cliente — preencha os dados')
    } catch { setDocStatus('error'); setDocMessage('Erro ao consultar') }
  }

  async function searchCEP() {
    const digits = f.address_zip.replace(/\D/g, '')
    if (digits.length !== 8) { toast.error('CEP deve ter 8 dígitos'); return }
    setCepLoading(true)
    try {
      const res = await fetch(`/api/consulta/cep/${digits}`)
      const data = await res.json()
      if (res.ok && data.data) {
        setF(prev => ({
          ...prev, address_street: data.data.address_street || prev.address_street,
          address_neighborhood: data.data.address_neighborhood || prev.address_neighborhood,
          address_city: data.data.address_city || prev.address_city,
          address_state: data.data.address_state || prev.address_state,
        }))
        toast.success('Endereço preenchido!')
      } else { toast.error(data.error || 'CEP não encontrado') }
    } catch { toast.error('Erro ao consultar CEP') } finally { setCepLoading(false) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.legal_name) { toast.error('Nome é obrigatório'); return }
    const payload = { ...f, document_number: f.document_number.replace(/\D/g, ''),
      phone: f.phone.replace(/\D/g, ''), mobile: f.mobile.replace(/\D/g, ''),
      address_zip: f.address_zip.replace(/\D/g, ''),
    }
    setSaving(true)
    try {
      let res: Response
      if (existingClientId) {
        // Existing client — just select it, update if needed
        res = await fetch(`/api/clientes/${existingClientId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/clientes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')
      onCreated(data.data)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') } finally { setSaving(false) }
  }

  const rawDoc = f.document_number.replace(/\D/g, '')
  const inp = "w-full px-3 py-2 border rounded-md text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors"

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Document search */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">CPF ou CNPJ</label>
        <div className="flex gap-2">
          <input type="text" value={f.document_number} onChange={e => handleDocChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchDoc() } }}
            placeholder="Digite CPF ou CNPJ..." className={inp + " font-mono flex-1"} autoFocus />
          <button type="button" onClick={searchDoc} disabled={rawDoc.length < 11 || docStatus === 'searching'}
            className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1">
            {docStatus === 'searching' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </button>
        </div>
        {docMessage && (
          <div className={`mt-1.5 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded ${
            docStatus === 'found' ? 'bg-blue-50 text-blue-700' :
            docStatus === 'cnpj-filled' ? 'bg-green-50 text-green-700' :
            docStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'
          }`}>
            {docStatus === 'found' && <CheckCircle className="w-3 h-3" />}
            {docStatus === 'cnpj-filled' && <Building2 className="w-3 h-3" />}
            {docStatus === 'not-found' && <User className="w-3 h-3" />}
            {docMessage}
          </div>
        )}
      </div>

      {/* Person/customer type */}
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="pt2" value="FISICA" title="Pessoa Física" checked={f.person_type === 'FISICA'} onChange={e => update('person_type', e.target.value)} />
          PF
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="pt2" value="JURIDICA" title="Pessoa Jurídica" checked={f.person_type === 'JURIDICA'} onChange={e => update('person_type', e.target.value)} />
          PJ
        </label>
        <span className="text-gray-300">|</span>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="ct2" value="CLIENTE" title="Cliente" checked={f.customer_type === 'CLIENTE'} onChange={e => update('customer_type', e.target.value)} />
          Cliente
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="ct2" value="FORNECEDOR" title="Fornecedor" checked={f.customer_type === 'FORNECEDOR'} onChange={e => update('customer_type', e.target.value)} />
          Fornecedor
        </label>
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {f.person_type === 'FISICA' ? 'Nome completo *' : 'Razão Social *'}
        </label>
        <input type="text" value={f.legal_name} onChange={e => update('legal_name', e.target.value)}
          placeholder={f.person_type === 'FISICA' ? 'Nome do cliente' : 'Razão social'}
          required className={inp} />
      </div>

      {f.person_type === 'JURIDICA' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome Fantasia</label>
          <input type="text" value={f.trade_name} onChange={e => update('trade_name', e.target.value)}
            placeholder="Nome fantasia" className={inp} />
        </div>
      )}

      {/* Contact */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Celular</label>
          <input type="tel" value={f.mobile} onChange={e => update('mobile', maskPhone(e.target.value))}
            placeholder="(11) 99999-0000" className={inp} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={f.email} onChange={e => update('email', e.target.value)}
            placeholder="email@exemplo.com" className={inp} />
        </div>
      </div>

      {/* Address */}
      <div className="border-t pt-3 mt-1 space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Endereço</h3>
        <div className="flex gap-2">
          <div className="w-36">
            <label className="block text-xs text-gray-500 mb-0.5">CEP</label>
            <input type="text" value={f.address_zip} onChange={e => update('address_zip', maskCEP(e.target.value))}
              onBlur={() => { if (f.address_zip.replace(/\D/g, '').length === 8) searchCEP() }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchCEP() } }}
              placeholder="00000-000" className={inp + " font-mono"} />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={searchCEP} disabled={cepLoading}
              className="px-2.5 py-2 text-xs bg-gray-100 border rounded-md hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1">
              {cepLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              CEP
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div className="col-span-3">
            <label className="block text-xs text-gray-500 mb-0.5">Rua</label>
            <input type="text" value={f.address_street} onChange={e => update('address_street', e.target.value)}
              placeholder="Rua, Avenida..." className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Nº</label>
            <input type="text" value={f.address_number} onChange={e => update('address_number', e.target.value)}
              placeholder="Nº" className={inp} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Bairro</label>
            <input type="text" value={f.address_neighborhood} onChange={e => update('address_neighborhood', e.target.value)}
              placeholder="Bairro" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cidade</label>
            <input type="text" value={f.address_city} onChange={e => update('address_city', e.target.value)}
              placeholder="Cidade" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">UF</label>
            <input type="text" value={f.address_state} onChange={e => update('address_state', e.target.value.toUpperCase())}
              maxLength={2} placeholder="SP" className={inp} />
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving}
          className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium
            flex items-center justify-center gap-2 transition-colors">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {saving ? 'Salvando...' : existingClientId ? 'Selecionar Cliente' : 'Cadastrar e Selecionar'}
        </button>
      </div>
    </form>
  )
}
