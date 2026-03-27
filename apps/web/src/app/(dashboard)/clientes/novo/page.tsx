'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Loader2, CheckCircle, AlertCircle, Building2, User } from 'lucide-react'

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
  return v.replace(/\D/g, '').slice(0, 8)
    .replace(/(\d{5})(\d)/, '$1-$2')
}

function maskPhone(v: string) {
  const digits = v.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  }
  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2')
}

type DocStatus = 'idle' | 'searching' | 'found' | 'not-found' | 'cnpj-filled' | 'error'

const emptyForm = {
  legal_name: '',
  trade_name: '',
  person_type: 'FISICA' as 'FISICA' | 'JURIDICA',
  customer_type: 'CLIENTE' as 'CLIENTE' | 'FORNECEDOR',
  document_number: '',
  email: '',
  phone: '',
  mobile: '',
  address_street: '',
  address_number: '',
  address_complement: '',
  address_neighborhood: '',
  address_city: '',
  address_state: '',
  address_zip: '',
  notes: '',
}

export default function NovoClientePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [docStatus, setDocStatus] = useState<DocStatus>('idle')
  const [docMessage, setDocMessage] = useState('')
  const [existingClientId, setExistingClientId] = useState<string | null>(null)
  const [cepLoading, setCepLoading] = useState(false)

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // ── Detect CPF vs CNPJ by length ──
  const rawDoc = form.document_number.replace(/\D/g, '')
  const detectedType = rawDoc.length <= 11 ? 'FISICA' : 'JURIDICA'

  // ── Auto-detect person type from document ──
  const handleDocumentChange = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '')
    const masked = digits.length <= 11 ? maskCPF(value) : maskCNPJ(value)
    const newType = digits.length <= 11 ? 'FISICA' : 'JURIDICA'

    setForm(prev => ({
      ...prev,
      document_number: masked,
      person_type: newType,
    }))
    setDocStatus('idle')
    setDocMessage('')
    setExistingClientId(null)
  }, [])

  // ── Search document (CPF/CNPJ) ──
  async function searchDocument() {
    const digits = form.document_number.replace(/\D/g, '')
    if (digits.length < 11) {
      toast.error('Digite um CPF (11 dígitos) ou CNPJ (14 dígitos) válido')
      return
    }

    setDocStatus('searching')
    setDocMessage('Consultando...')

    try {
      // 1) Check if client already exists in the database
      const existRes = await fetch(`/api/clientes/por-documento/${digits}`)
      const existData = await existRes.json()

      if (existData.data) {
        const c = existData.data
        setForm({
          legal_name: c.legal_name || '',
          trade_name: c.trade_name || '',
          person_type: c.person_type === 'JURIDICA' ? 'JURIDICA' : 'FISICA',
          customer_type: c.customer_type || 'CLIENTE',
          document_number: form.document_number,
          email: c.email || '',
          phone: c.phone ? maskPhone(c.phone) : '',
          mobile: c.mobile ? maskPhone(c.mobile) : '',
          address_street: c.address_street || '',
          address_number: c.address_number || '',
          address_complement: c.address_complement || '',
          address_neighborhood: c.address_neighborhood || '',
          address_city: c.address_city || '',
          address_state: c.address_state || '',
          address_zip: c.address_zip ? maskCEP(c.address_zip) : '',
          notes: c.notes || '',
        })
        setExistingClientId(c.id)
        setDocStatus('found')
        setDocMessage(`Cliente já cadastrado: ${c.legal_name}`)
        toast.info('Cliente encontrado! Dados preenchidos. Você pode editar e salvar.')
        return
      }

      // 2) If CNPJ, query Receita Federal
      if (digits.length === 14) {
        const cnpjRes = await fetch(`/api/consulta/cnpj/${digits}`)
        const cnpjData = await cnpjRes.json()

        if (cnpjRes.ok && cnpjData.data) {
          const d = cnpjData.data
          setForm(prev => ({
            ...prev,
            person_type: 'JURIDICA',
            legal_name: d.legal_name || prev.legal_name,
            trade_name: d.trade_name || prev.trade_name,
            email: d.email || prev.email,
            phone: d.phone ? maskPhone(d.phone) : prev.phone,
            address_street: d.address_street || prev.address_street,
            address_number: d.address_number || prev.address_number,
            address_complement: d.address_complement || prev.address_complement,
            address_neighborhood: d.address_neighborhood || prev.address_neighborhood,
            address_city: d.address_city || prev.address_city,
            address_state: d.address_state || prev.address_state,
            address_zip: d.address_zip ? maskCEP(d.address_zip) : prev.address_zip,
          }))
          setDocStatus('cnpj-filled')
          setDocMessage(`${d.situacao || 'Ativa'} — ${d.atividade_principal || ''}`)
          toast.success('Dados da Receita Federal preenchidos!')
          return
        }

        if (cnpjRes.status === 404) {
          setDocStatus('not-found')
          setDocMessage('CNPJ não encontrado na Receita Federal')
          return
        }
      }

      // 3) CPF — no public API, just mark as new
      setDocStatus('not-found')
      setDocMessage('Novo cliente — preencha os dados abaixo')
    } catch {
      setDocStatus('error')
      setDocMessage('Erro ao consultar. Tente novamente.')
    }
  }

  // ── CEP auto-fill ──
  async function searchCEP() {
    const digits = form.address_zip.replace(/\D/g, '')
    if (digits.length !== 8) {
      toast.error('CEP deve ter 8 dígitos')
      return
    }

    setCepLoading(true)
    try {
      const res = await fetch(`/api/consulta/cep/${digits}`)
      const data = await res.json()

      if (res.ok && data.data) {
        setForm(prev => ({
          ...prev,
          address_street: data.data.address_street || prev.address_street,
          address_neighborhood: data.data.address_neighborhood || prev.address_neighborhood,
          address_city: data.data.address_city || prev.address_city,
          address_state: data.data.address_state || prev.address_state,
        }))
        toast.success('Endereço preenchido!')
      } else {
        toast.error(data.error || 'CEP não encontrado')
      }
    } catch {
      toast.error('Erro ao consultar CEP')
    } finally {
      setCepLoading(false)
    }
  }

  // ── Submit ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.legal_name) { toast.error('Nome é obrigatório'); return }

    // Strip masks before sending
    const payload = {
      ...form,
      document_number: form.document_number.replace(/\D/g, ''),
      phone: form.phone.replace(/\D/g, ''),
      mobile: form.mobile.replace(/\D/g, ''),
      address_zip: form.address_zip.replace(/\D/g, ''),
    }

    setLoading(true)
    try {
      let res: Response
      if (existingClientId) {
        res = await fetch(`/api/clientes/${existingClientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch('/api/clientes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      toast.success(existingClientId ? 'Cliente atualizado!' : 'Cliente cadastrado!')
      router.push('/clientes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setLoading(false)
    }
  }

  const isEditing = existingClientId !== null

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {isEditing ? 'Editar Cliente' : 'Novo Cliente'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── STEP 1: Document ── */}
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Search className="w-4 h-4" />
            Comece pelo documento
          </h2>
          <p className="text-sm text-gray-500">
            Digite o CPF ou CNPJ para buscar dados automaticamente
          </p>

          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={form.document_number}
                onChange={e => handleDocumentChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchDocument() } }}
                placeholder="Digite CPF ou CNPJ..."
                className="w-full px-4 py-3 border-2 rounded-lg text-lg font-mono tracking-wider
                  focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors"
                autoFocus
              />
              {rawDoc.length >= 11 && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">
                  {detectedType === 'FISICA' ? 'CPF' : 'CNPJ'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={searchDocument}
              disabled={rawDoc.length < 11 || docStatus === 'searching'}
              className="px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40
                disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
            >
              {docStatus === 'searching' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Consultar
            </button>
          </div>

          {/* Status message */}
          {docMessage && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              docStatus === 'found' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
              docStatus === 'cnpj-filled' ? 'bg-green-50 text-green-700 border border-green-200' :
              docStatus === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
              'bg-gray-50 text-gray-600 border border-gray-200'
            }`}>
              {docStatus === 'found' && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
              {docStatus === 'cnpj-filled' && <Building2 className="w-4 h-4 flex-shrink-0" />}
              {docStatus === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
              {docStatus === 'not-found' && <User className="w-4 h-4 flex-shrink-0" />}
              {docMessage}
            </div>
          )}
        </div>

        {/* ── STEP 2: Identification ── */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Identificação</h2>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="person_type" value="FISICA" title="Pessoa Física"
                checked={form.person_type === 'FISICA'}
                onChange={e => update('person_type', e.target.value)}
                className="text-blue-600" />
              <span className="text-sm">Pessoa Física</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="person_type" value="JURIDICA" title="Pessoa Jurídica"
                checked={form.person_type === 'JURIDICA'}
                onChange={e => update('person_type', e.target.value)}
                className="text-blue-600" />
              <span className="text-sm">Pessoa Jurídica</span>
            </label>
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="customer_type" value="CLIENTE" title="Cliente"
                checked={form.customer_type === 'CLIENTE'}
                onChange={e => update('customer_type', e.target.value)}
                className="text-blue-600" />
              <span className="text-sm">Cliente</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="customer_type" value="FORNECEDOR" title="Fornecedor"
                checked={form.customer_type === 'FORNECEDOR'}
                onChange={e => update('customer_type', e.target.value)}
                className="text-blue-600" />
              <span className="text-sm">Fornecedor</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {form.person_type === 'FISICA' ? 'Nome completo *' : 'Razão Social *'}
            </label>
            <input type="text" value={form.legal_name} onChange={e => update('legal_name', e.target.value)}
              placeholder={form.person_type === 'FISICA' ? 'Nome do cliente' : 'Razão social da empresa'}
              required className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
          </div>

          {form.person_type === 'JURIDICA' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome Fantasia</label>
              <input type="text" value={form.trade_name} onChange={e => update('trade_name', e.target.value)}
                placeholder="Nome fantasia da empresa"
                className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
          )}
        </div>

        {/* ── STEP 3: Contact ── */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Contato</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Celular</label>
              <input type="tel" value={form.mobile}
                onChange={e => update('mobile', maskPhone(e.target.value))}
                placeholder="(11) 99999-0000"
                className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input type="tel" value={form.phone}
                onChange={e => update('phone', maskPhone(e.target.value))}
                placeholder="(11) 3136-0415"
                className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)}
                placeholder="email@exemplo.com"
                className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
          </div>
        </div>

        {/* ── STEP 4: Address ── */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Endereço</h2>

          {/* CEP first */}
          <div className="flex gap-2">
            <div className="w-44">
              <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
              <input type="text" value={form.address_zip}
                onChange={e => update('address_zip', maskCEP(e.target.value))}
                onBlur={() => { if (form.address_zip.replace(/\D/g, '').length === 8) searchCEP() }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchCEP() } }}
                placeholder="00000-000"
                className="w-full px-3 py-2 border rounded-md font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={searchCEP} disabled={cepLoading}
                className="px-3 py-2 text-sm bg-gray-100 border rounded-md hover:bg-gray-200 transition-colors
                  disabled:opacity-50 flex items-center gap-1.5">
                {cepLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Buscar CEP
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Rua</label>
              <input type="text" value={form.address_street} onChange={e => update('address_street', e.target.value)}
                placeholder="Rua, Avenida..." className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
              <input type="text" value={form.address_number} onChange={e => update('address_number', e.target.value)}
                placeholder="Nº" className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
              <input type="text" value={form.address_complement} onChange={e => update('address_complement', e.target.value)}
                placeholder="Sala, Bloco..." className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bairro</label>
              <input type="text" value={form.address_neighborhood} onChange={e => update('address_neighborhood', e.target.value)}
                placeholder="Bairro" className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                <input type="text" value={form.address_city} onChange={e => update('address_city', e.target.value)}
                  placeholder="Cidade" className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">UF</label>
                <input type="text" value={form.address_state} onChange={e => update('address_state', e.target.value.toUpperCase())}
                  maxLength={2} placeholder="SP" className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Observations ── */}
        <div className="rounded-lg border bg-white p-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
          <textarea value={form.notes} onChange={e => update('notes', e.target.value)}
            rows={2} placeholder="Anotações sobre o cliente..."
            className="w-full px-3 py-2 border rounded-md resize-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors" />
        </div>

        {/* ── Submit ── */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50
              font-medium transition-colors flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Salvando...' : isEditing ? 'Atualizar Cliente' : 'Cadastrar Cliente'}
          </button>
        </div>
      </form>
    </div>
  )
}
