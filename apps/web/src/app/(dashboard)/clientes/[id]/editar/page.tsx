'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Search, ArrowLeft, Building2 } from 'lucide-react'
import Link from 'next/link'

function maskCEP(v: string) {
  return v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}
function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}
function maskCPF(v: string) {
  return v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}
function maskCNPJ(v: string) {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}
function maskDoc(v: string) {
  const digits = v.replace(/\D/g, '')
  return digits.length <= 11 ? maskCPF(v) : maskCNPJ(v)
}

export default function EditarClientePage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)
  const [cnpjLoading, setCnpjLoading] = useState(false)

  const [form, setForm] = useState({
    legal_name: '', trade_name: '', person_type: 'FISICA', customer_type: 'CLIENTE',
    document_number: '', email: '', phone: '', mobile: '',
    address_zip: '', address_street: '', address_number: '', address_complement: '',
    address_neighborhood: '', address_city: '', address_state: '', notes: '',
  })

  useEffect(() => {
    fetch(`/api/clientes/${id}`)
      .then(r => r.json())
      .then(d => {
        const c = d.data ?? d
        if (!c || d.error) { toast.error('Cliente não encontrado'); router.push('/clientes'); return }
        setForm({
          legal_name: c.legal_name || '',
          trade_name: c.trade_name || '',
          person_type: c.person_type || 'FISICA',
          customer_type: c.customer_type || 'CLIENTE',
          document_number: c.document_number ? maskDoc(c.document_number) : '',
          email: c.email || '',
          phone: c.phone ? maskPhone(c.phone) : '',
          mobile: c.mobile ? maskPhone(c.mobile) : '',
          address_zip: c.address_zip ? maskCEP(c.address_zip) : '',
          address_street: c.address_street || '',
          address_number: c.address_number || '',
          address_complement: c.address_complement || '',
          address_neighborhood: c.address_neighborhood || '',
          address_city: c.address_city || '',
          address_state: c.address_state || '',
          notes: c.notes || '',
        })
      })
      .catch(() => { toast.error('Erro ao carregar cliente'); router.push('/clientes') })
      .finally(() => setLoading(false))
  }, [id, router])

  function update(field: string, value: string) { setForm(prev => ({ ...prev, [field]: value })) }

  async function searchCNPJ() {
    const digits = form.document_number.replace(/\D/g, '')
    if (digits.length !== 14) { toast.error('CNPJ deve ter 14 dígitos'); return }
    setCnpjLoading(true)
    try {
      const res = await fetch(`/api/consulta/cnpj/${digits}`)
      const data = await res.json()
      if (res.ok && data.data) {
        const d = data.data
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
        toast.success(`Dados atualizados da Receita Federal — ${d.situacao || 'Ativa'}`)
      } else {
        toast.error(data.error || 'CNPJ não encontrado')
      }
    } catch { toast.error('Erro ao consultar CNPJ') } finally { setCnpjLoading(false) }
  }

  async function searchCEP() {
    const digits = form.address_zip.replace(/\D/g, '')
    if (digits.length !== 8) { toast.error('CEP deve ter 8 dígitos'); return }
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
      } else { toast.error(data.error || 'CEP não encontrado') }
    } catch { toast.error('Erro ao consultar CEP') } finally { setCepLoading(false) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.legal_name) { toast.error('Nome é obrigatório'); return }

    const payload = {
      ...form,
      document_number: form.document_number.replace(/\D/g, ''),
      phone: form.phone.replace(/\D/g, ''),
      mobile: form.mobile.replace(/\D/g, ''),
      address_zip: form.address_zip.replace(/\D/g, ''),
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/clientes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')

      toast.success('Cliente atualizado!')
      router.push(`/clientes/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>

  const inp = "w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors"

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/clientes/${id}`} className="rounded-md border p-2 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Editar Cliente</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Identification */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Identificação</h2>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="person_type" value="FISICA" title="Pessoa Física"
                checked={form.person_type === 'FISICA'} onChange={e => update('person_type', e.target.value)} className="text-blue-600" />
              <span className="text-sm">Pessoa Física</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="person_type" value="JURIDICA" title="Pessoa Jurídica"
                checked={form.person_type === 'JURIDICA'} onChange={e => update('person_type', e.target.value)} className="text-blue-600" />
              <span className="text-sm">Pessoa Jurídica</span>
            </label>
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="customer_type" value="CLIENTE" title="Cliente"
                checked={form.customer_type === 'CLIENTE'} onChange={e => update('customer_type', e.target.value)} className="text-blue-600" />
              <span className="text-sm">Cliente</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="customer_type" value="FORNECEDOR" title="Fornecedor"
                checked={form.customer_type === 'FORNECEDOR'} onChange={e => update('customer_type', e.target.value)} className="text-blue-600" />
              <span className="text-sm">Fornecedor</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {form.person_type === 'FISICA' ? 'CPF' : 'CNPJ'}
            </label>
            <div className="flex gap-2">
              <input type="text" value={form.document_number}
                onChange={e => update('document_number', maskDoc(e.target.value))}
                placeholder={form.person_type === 'FISICA' ? '000.000.000-00' : '00.000.000/0001-00'}
                className={inp + " font-mono flex-1"} />
              {form.document_number.replace(/\D/g, '').length === 14 && (
                <button type="button" onClick={searchCNPJ} disabled={cnpjLoading}
                  className="px-3 py-2 text-sm bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 disabled:opacity-50 flex items-center gap-1.5 text-amber-700 whitespace-nowrap">
                  {cnpjLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Building2 className="w-3.5 h-3.5" />}
                  Consultar Receita
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {form.person_type === 'FISICA' ? 'Nome completo *' : 'Razão Social *'}
            </label>
            <input type="text" value={form.legal_name} onChange={e => update('legal_name', e.target.value)}
              placeholder={form.person_type === 'FISICA' ? 'Nome do cliente' : 'Razão social da empresa'}
              required className={inp} />
          </div>

          {form.person_type === 'JURIDICA' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome Fantasia</label>
              <input type="text" value={form.trade_name} onChange={e => update('trade_name', e.target.value)}
                placeholder="Nome fantasia da empresa" className={inp} />
            </div>
          )}
        </div>

        {/* Contact */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Contato</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Celular</label>
              <input type="tel" value={form.mobile} onChange={e => update('mobile', maskPhone(e.target.value))}
                placeholder="(11) 99999-0000" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input type="tel" value={form.phone} onChange={e => update('phone', maskPhone(e.target.value))}
                placeholder="(11) 3136-0415" className={inp} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)}
                placeholder="email@exemplo.com" className={inp} />
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Endereço</h2>

          <div className="flex gap-2">
            <div className="w-44">
              <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
              <input type="text" value={form.address_zip}
                onChange={e => update('address_zip', maskCEP(e.target.value))}
                onBlur={() => { if (form.address_zip.replace(/\D/g, '').length === 8) searchCEP() }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchCEP() } }}
                placeholder="00000-000" className={inp + " font-mono"} />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={searchCEP} disabled={cepLoading}
                className="px-3 py-2 text-sm bg-gray-100 border rounded-md hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1.5">
                {cepLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Buscar CEP
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Rua</label>
              <input type="text" value={form.address_street} onChange={e => update('address_street', e.target.value)}
                placeholder="Rua, Avenida..." className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
              <input type="text" value={form.address_number} onChange={e => update('address_number', e.target.value)}
                placeholder="Nº" className={inp} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
              <input type="text" value={form.address_complement} onChange={e => update('address_complement', e.target.value)}
                placeholder="Sala, Bloco..." className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bairro</label>
              <input type="text" value={form.address_neighborhood} onChange={e => update('address_neighborhood', e.target.value)}
                placeholder="Bairro" className={inp} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
                <input type="text" value={form.address_city} onChange={e => update('address_city', e.target.value)}
                  placeholder="Cidade" className={inp} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">UF</label>
                <input type="text" value={form.address_state} onChange={e => update('address_state', e.target.value.toUpperCase())}
                  maxLength={2} placeholder="SP" className={inp} />
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-lg border bg-white p-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
          <textarea value={form.notes} onChange={e => update('notes', e.target.value)}
            rows={3} placeholder="Anotações sobre o cliente..."
            className={inp + " resize-none"} />
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.push(`/clientes/${id}`)}
            className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50
              font-medium transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </form>
    </div>
  )
}
