'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, X, Search, Loader2, CheckCircle, Building2, User, ChevronDown, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface Cliente { id: string; legal_name: string; trade_name: string | null }
interface UserProfile { id: string; name: string }

export default function NovaOSPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [searchCliente, setSearchCliente] = useState('')
  const [showNovoCliente, setShowNovoCliente] = useState(false)

  // Brands & models
  const [marcas, setMarcas] = useState<string[]>([])
  const [modelos, setModelos] = useState<string[]>([])
  const [marcaSearch, setMarcaSearch] = useState('')
  const [modeloSearch, setModeloSearch] = useState('')
  const [showMarcaDropdown, setShowMarcaDropdown] = useState(false)
  const [showModeloDropdown, setShowModeloDropdown] = useState(false)
  const [modeloOutro, setModeloOutro] = useState(false)
  const marcaRef = useRef<HTMLDivElement>(null)
  const modeloRef = useRef<HTMLDivElement>(null)

  // Technicians
  const [tecnicos, setTecnicos] = useState<UserProfile[]>([])
  const [tiposOS, setTiposOS] = useState<{ key: string; label: string }[]>([])
  const [locaisOS, setLocaisOS] = useState<{ key: string; label: string }[]>([])
  const [equipTypes, setEquipTypes] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/settings/tipos-os').then(r => r.json()).then(d => setTiposOS(d.data ?? [])).catch(() => {})
    fetch('/api/settings/locais-os').then(r => r.json()).then(d => setLocaisOS(d.data ?? [])).catch(() => {})
    fetch('/api/settings/equipamentos-os').then(r => r.json()).then(d => setEquipTypes(d.data ?? [])).catch(() => {})
  }, [])

  const [form, setForm] = useState({
    customer_id: '',
    equipment_type: 'Impressora',
    equipment_brand: '',
    equipment_model: '',
    serial_number: '',
    reported_issue: '',
    reception_notes: '',
    internal_notes: '',
    priority: 'MEDIUM',
    os_type: 'AVULSO',
    os_location: 'EXTERNO',
    technician_id: '',
    estimated_delivery: '',
  })

  // Load brands on mount
  useEffect(() => {
    fetch('/api/equipamentos?type=marcas')
      .then(r => r.json())
      .then(d => setMarcas(d.data ?? []))
      .catch(() => {})
  }, [])

  // Load technicians on mount
  useEffect(() => {
    fetch('/api/users?simple=true')
      .then(r => r.json())
      .then(d => setTecnicos(d.data ?? []))
      .catch(() => {})
  }, [])

  // Load models when brand changes
  useEffect(() => {
    if (!form.equipment_brand) { setModelos([]); return }
    fetch(`/api/equipamentos?type=modelos&marca=${encodeURIComponent(form.equipment_brand)}`)
      .then(r => r.json())
      .then(d => setModelos(d.data ?? []))
      .catch(() => {})
  }, [form.equipment_brand])

  // Handle ?cliente= or ?clonar= query params
  useEffect(() => {
    const clienteId = searchParams.get('cliente')
    const clonarId = searchParams.get('clonar')

    if (clonarId) {
      // Clone: fetch OS data and pre-fill
      fetch(`/api/os/${clonarId}`)
        .then(r => r.json())
        .then(d => {
          const os = d.data
          if (!os) return
          setForm({
            customer_id: os.customer_id || '',
            equipment_type: os.equipment_type || 'Impressora',
            equipment_brand: os.equipment_brand || '',
            equipment_model: os.equipment_model || '',
            serial_number: os.serial_number || '',
            reported_issue: os.reported_issue || '',
            reception_notes: os.reception_notes || '',
            internal_notes: os.internal_notes || '',
            priority: os.priority || 'MEDIUM',
            os_type: os.os_type || 'BALCAO',
            os_location: os.os_location || 'LOJA',
            technician_id: os.technician_id || '',
            estimated_delivery: '',
          })
          if (os.equipment_brand) setMarcaSearch(os.equipment_brand)
          if (os.equipment_model) setModeloSearch(os.equipment_model)
          if (os.customers) {
            setClientes([os.customers])
            setSearchCliente(os.customers.legal_name)
          }
        })
        .catch(() => toast.error('Erro ao carregar OS para clonar'))
    } else if (clienteId) {
      // Pre-fill client by fetching their data
      fetch(`/api/clientes/${clienteId}`)
        .then(r => r.json())
        .then(d => {
          const c = d.data
          if (c) {
            setForm(p => ({ ...p, customer_id: c.id }))
            setClientes([c])
            setSearchCliente(c.legal_name)
          }
        })
        .catch(() => {
          setForm(p => ({ ...p, customer_id: clienteId }))
        })
    }
  }, [searchParams])

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (marcaRef.current && !marcaRef.current.contains(e.target as Node)) setShowMarcaDropdown(false)
      if (modeloRef.current && !modeloRef.current.contains(e.target as Node)) setShowModeloDropdown(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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

  function selectMarca(marca: string) {
    setForm(prev => ({ ...prev, equipment_brand: marca, equipment_model: '' }))
    setMarcaSearch(marca)
    setModeloSearch('')
    setModeloOutro(false)
    setShowMarcaDropdown(false)
  }

  function selectModelo(modelo: string) {
    if (modelo === '__outro__') {
      setModeloOutro(true)
      setModeloSearch('')
      setForm(prev => ({ ...prev, equipment_model: '' }))
      setShowModeloDropdown(false)
      return
    }
    setForm(prev => ({ ...prev, equipment_model: modelo }))
    setModeloSearch(modelo)
    setModeloOutro(false)
    setShowModeloDropdown(false)
  }

  const filteredMarcas = marcas.filter(m =>
    m.toLowerCase().includes(marcaSearch.toLowerCase())
  )

  const filteredModelos = modelos.filter(m =>
    m.toLowerCase().includes(modeloSearch.toLowerCase())
  )

  const [errors, setErrors] = useState<Record<string, string>>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: Record<string, string> = {}
    if (!form.customer_id) newErrors.customer_id = 'Selecione um cliente'
    if (!form.equipment_type) newErrors.equipment_type = 'Informe o tipo de equipamento'
    if (!form.reported_issue) newErrors.reported_issue = 'Descreva o problema relatado'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      toast.error(Object.values(newErrors)[0])
      return
    }
    setErrors({})

    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        customer_id: form.customer_id,
        equipment_type: form.equipment_type,
        equipment_brand: form.equipment_brand || undefined,
        equipment_model: form.equipment_model || undefined,
        serial_number: form.serial_number || undefined,
        reported_issue: form.reported_issue,
        reception_notes: form.reception_notes || undefined,
        internal_notes: form.internal_notes || undefined,
        priority: form.priority,
        os_type: form.os_type,
        os_location: form.os_location || undefined,
        technician_id: form.technician_id || undefined,
        estimated_delivery: form.estimated_delivery || undefined,
      }

      const res = await fetch('/api/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      <div className="flex items-center gap-3 mb-6">
        <Link href="/os" className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nova Ordem de Servico</h1>
          <p className="text-sm text-gray-500">
            <Link href="/os" className="text-blue-600 hover:underline">Ordens de Servico</Link> / Nova
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Local — PRIMEIRO CAMPO (define status inicial) */}
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-5">
          <h2 className="font-semibold text-gray-900 mb-3">Onde esta o equipamento? <span className="text-red-500">*</span></h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => updateForm('os_location', 'EXTERNO')}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                form.os_location === 'EXTERNO'
                  ? 'border-blue-600 bg-blue-600 text-white shadow-md'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
              }`}
            >
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span className="font-semibold text-sm">Externo (Coleta)</span>
              <span className={`text-xs ${form.os_location === 'EXTERNO' ? 'text-blue-200' : 'text-gray-400'}`}>Motorista busca</span>
            </button>
            <button
              type="button"
              onClick={() => updateForm('os_location', 'LOJA')}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                form.os_location === 'LOJA'
                  ? 'border-blue-600 bg-blue-600 text-white shadow-md'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
              }`}
            >
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span className="font-semibold text-sm">Loja (Balcao)</span>
              <span className={`text-xs ${form.os_location === 'LOJA' ? 'text-blue-200' : 'text-gray-400'}`}>Cliente trouxe</span>
            </button>
          </div>
          <p className="text-xs text-blue-700 mt-2 text-center">
            {form.os_location === 'EXTERNO'
              ? 'Status inicial: Coletar — motorista vai buscar o equipamento'
              : 'Status inicial: Orcar — equipamento ja esta na loja'}
          </p>
        </div>

        {/* Cliente */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Cliente <span className="text-red-500">*</span></h2>
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
              <p className="mt-1 text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5" /> {selectedCliente.legal_name}
              </p>
            )}
            {errors.customer_id && <p className="mt-1 text-sm text-red-500">{errors.customer_id}</p>}
          </div>
        </div>

        {/* Equipamento */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Equipamento</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tipo</label>
              <select value={form.equipment_type} onChange={e => updateForm('equipment_type', e.target.value)}
                title="Tipo de equipamento" className="w-full px-3 py-2 border rounded-md">
                {equipTypes.length > 0 ? equipTypes.map(t => (
                  <option key={t} value={t}>{t}</option>
                )) : (
                  <>
                    <option>Impressora</option>
                    <option>Notebook</option>
                    <option>Termica</option>
                    <option>Outro</option>
                  </>
                )}
              </select>
            </div>
            {/* Marca - searchable select */}
            <div ref={marcaRef} className="relative">
              <label className="block text-sm text-gray-600 mb-1">Marca</label>
              <div className="relative">
                <input
                  type="text"
                  value={marcaSearch}
                  onChange={e => {
                    setMarcaSearch(e.target.value)
                    setShowMarcaDropdown(true)
                    if (!e.target.value) updateForm('equipment_brand', '')
                  }}
                  onFocus={() => setShowMarcaDropdown(true)}
                  placeholder="Selecione ou digite..."
                  className="w-full px-3 py-2 pr-8 border rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <ChevronDown className="absolute right-2.5 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
              </div>
              {showMarcaDropdown && (
                <div className="absolute z-20 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {filteredMarcas.length > 0 ? filteredMarcas.map(m => (
                    <button key={m} type="button" onClick={() => selectMarca(m)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                        form.equipment_brand === m ? 'bg-blue-50 text-blue-700 font-medium' : ''
                      }`}>
                      {m}
                    </button>
                  )) : (
                    <div className="px-3 py-2 text-sm text-gray-400">
                      {marcaSearch ? 'Nenhuma marca encontrada' : 'Carregando...'}
                    </div>
                  )}
                  {marcaSearch && !marcas.includes(marcaSearch) && (
                    <button type="button"
                      onClick={() => {
                        updateForm('equipment_brand', marcaSearch)
                        setShowMarcaDropdown(false)
                      }}
                      className="w-full text-left px-3 py-2 text-sm border-t text-blue-600 hover:bg-blue-50 font-medium">
                      Usar "{marcaSearch}"
                    </button>
                  )}
                </div>
              )}
            </div>
            {/* Modelo - searchable select */}
            <div ref={modeloRef} className="relative">
              <label className="block text-sm text-gray-600 mb-1">Modelo</label>
              {modeloOutro ? (
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={form.equipment_model}
                    onChange={e => updateForm('equipment_model', e.target.value)}
                    placeholder="Digite o modelo..."
                    className="flex-1 px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    autoFocus
                  />
                  <button type="button" onClick={() => { setModeloOutro(false); setModeloSearch(''); updateForm('equipment_model', '') }}
                    className="px-2 py-2 text-xs text-gray-500 hover:text-gray-700 border rounded-md hover:bg-gray-50">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={modeloSearch}
                    onChange={e => {
                      setModeloSearch(e.target.value)
                      setShowModeloDropdown(true)
                      if (!e.target.value) updateForm('equipment_model', '')
                    }}
                    onFocus={() => { if (form.equipment_brand) setShowModeloDropdown(true) }}
                    placeholder={form.equipment_brand ? 'Selecione ou digite...' : 'Selecione marca primeiro'}
                    disabled={!form.equipment_brand}
                    className="w-full px-3 py-2 pr-8 border rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  <ChevronDown className="absolute right-2.5 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
              )}
              {showModeloDropdown && form.equipment_brand && !modeloOutro && (
                <div className="absolute z-20 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {filteredModelos.map(m => (
                    <button key={m} type="button" onClick={() => selectModelo(m)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                        form.equipment_model === m ? 'bg-blue-50 text-blue-700 font-medium' : ''
                      }`}>
                      {m}
                    </button>
                  ))}
                  {modeloSearch && !modelos.includes(modeloSearch) && (
                    <button type="button"
                      onClick={() => {
                        updateForm('equipment_model', modeloSearch)
                        setShowModeloDropdown(false)
                      }}
                      className="w-full text-left px-3 py-2 text-sm border-t text-blue-600 hover:bg-blue-50 font-medium">
                      Usar "{modeloSearch}"
                    </button>
                  )}
                  <button type="button" onClick={() => selectModelo('__outro__')}
                    className="w-full text-left px-3 py-2 text-sm border-t text-gray-500 hover:bg-gray-50">
                    Outro (digitar manualmente)
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">N Serie</label>
              <input type="text" value={form.serial_number} onChange={e => updateForm('serial_number', e.target.value)}
                placeholder="Ex: ABC1234567" className="w-full px-3 py-2 border rounded-md" />
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
              className={`w-full px-3 py-2 border rounded-md resize-none ${errors.reported_issue ? 'border-red-400' : ''}`} />
            {errors.reported_issue && <p className="mt-1 text-sm text-red-500">{errors.reported_issue}</p>}
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Observacoes</label>
            <textarea value={form.reception_notes} onChange={e => updateForm('reception_notes', e.target.value)}
              rows={2} placeholder="Estado do equipamento na entrada, acessorios..."
              className="w-full px-3 py-2 border rounded-md resize-none" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Observacoes Internas</label>
            <textarea value={form.internal_notes} onChange={e => updateForm('internal_notes', e.target.value)}
              rows={2} placeholder="Notas internas (nao visivel ao cliente)..."
              className="w-full px-3 py-2 border rounded-md resize-none bg-yellow-50 border-yellow-200 focus:ring-yellow-400 focus:border-yellow-400" />
            <p className="text-xs text-yellow-600 mt-0.5">Visivel apenas para a equipe</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Prioridade</label>
              <select value={form.priority} onChange={e => updateForm('priority', e.target.value)}
                title="Prioridade" className="w-full px-3 py-2 border rounded-md">
                <option value="LOW">Baixa</option>
                <option value="MEDIUM">Media</option>
                <option value="HIGH">Alta</option>
                <option value="URGENT">Urgente</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tipo de OS</label>
              <select value={form.os_type} onChange={e => updateForm('os_type', e.target.value)}
                title="Tipo de OS" className="w-full px-3 py-2 border rounded-md">
                {tiposOS.length > 0 ? tiposOS.map(t => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                )) : (
                  <>
                    <option value="BALCAO">Balcao</option>
                    <option value="COLETA">Coleta</option>
                  </>
                )}
              </select>
            </div>
            {/* Local já definido no primeiro card */}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Tecnico Responsavel</label>
              <select value={form.technician_id} onChange={e => updateForm('technician_id', e.target.value)}
                title="Tecnico Responsavel" className="w-full px-3 py-2 border rounded-md">
                <option value="">Nao atribuido</option>
                {tecnicos.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Data de Previsao</label>
              <input type="date" value={form.estimated_delivery} onChange={e => updateForm('estimated_delivery', e.target.value)}
                title="Data de Previsao" className="w-full px-3 py-2 border rounded-md" />
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
            {loading ? 'Criando...' : 'Criar Ordem de Servico'}
          </button>
        </div>
      </form>

      {/* Modal Novo Cliente */}
      {showNovoCliente && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-6">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl my-auto">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Cadastro Rapido de Cliente</h2>
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
      let existingClient = null
      try {
        const existRes = await fetch(`/api/clientes/por-documento/${digits}`)
        if (existRes.ok) { const existData = await existRes.json(); existingClient = existData.data }
      } catch { /* continue to CNPJ lookup */ }
      if (existingClient) {
        const c = existingClient
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
      // CPF — consultar API paga (se habilitada)
      if (digits.length === 11) {
        try {
          const cpfRes = await fetch(`/api/consulta/cpf/${digits}`)
          const cpfData = await cpfRes.json()
          if (cpfRes.ok && cpfData.data && cpfData.data.legal_name) {
            setF(prev => ({ ...prev, person_type: 'FISICA', legal_name: cpfData.data.legal_name }))
            setDocStatus('cnpj-filled'); setDocMessage(`${cpfData.data.situacao || 'Regular'} — ${cpfData.data.legal_name}`)
            toast.success('Nome preenchido automaticamente!')
            return
          }
        } catch { /* API nao habilitada — continuar sem preencher */ }
      }
      setDocStatus('not-found'); setDocMessage('Novo cliente — preencha os dados')
    } catch { setDocStatus('error'); setDocMessage('Erro ao consultar') }
  }

  async function searchCEP() {
    const digits = f.address_zip.replace(/\D/g, '')
    if (digits.length !== 8) { toast.error('CEP deve ter 8 digitos'); return }
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
        toast.success('Endereco preenchido!')
      } else { toast.error(data.error || 'CEP nao encontrado') }
    } catch { toast.error('Erro ao consultar CEP') } finally { setCepLoading(false) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.legal_name) { toast.error('Nome e obrigatorio'); return }
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
            title="Buscar documento"
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
          <input type="radio" name="pt2" value="FISICA" aria-label="Pessoa Fisica" title="Pessoa Fisica" checked={f.person_type === 'FISICA'} onChange={e => update('person_type', e.target.value)} />
          PF
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="pt2" value="JURIDICA" aria-label="Pessoa Juridica" title="Pessoa Juridica" checked={f.person_type === 'JURIDICA'} onChange={e => update('person_type', e.target.value)} />
          PJ
        </label>
        <span className="text-gray-300">|</span>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="ct2" value="CLIENTE" aria-label="Cliente" title="Cliente" checked={f.customer_type === 'CLIENTE'} onChange={e => update('customer_type', e.target.value)} />
          Cliente
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="radio" name="ct2" value="FORNECEDOR" aria-label="Fornecedor" title="Fornecedor" checked={f.customer_type === 'FORNECEDOR'} onChange={e => update('customer_type', e.target.value)} />
          Fornecedor
        </label>
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {f.person_type === 'FISICA' ? 'Nome completo *' : 'Razao Social *'}
        </label>
        <input type="text" value={f.legal_name} onChange={e => update('legal_name', e.target.value)}
          placeholder={f.person_type === 'FISICA' ? 'Nome do cliente' : 'Razao social'}
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
        <h3 className="text-sm font-semibold text-gray-700">Endereco</h3>
        <div className="flex gap-2">
          <div className="w-36">
            <label className="block text-xs text-gray-500 mb-0.5">CEP</label>
            <input type="text" value={f.address_zip} onChange={e => update('address_zip', maskCEP(e.target.value))}
              onBlur={() => { if (f.address_zip.replace(/\D/g, '').length === 8) searchCEP() }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchCEP() } }}
              placeholder="00000-000" className={inp + " font-mono"} />
          </div>
          <div className="flex items-end">
            <button type="button" onClick={searchCEP} disabled={cepLoading} title="Buscar CEP"
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
            <label className="block text-xs text-gray-500 mb-0.5">N</label>
            <input type="text" value={f.address_number} onChange={e => update('address_number', e.target.value)}
              placeholder="N" className={inp} />
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
