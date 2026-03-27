'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Search } from 'lucide-react'

function maskCEP(v: string) {
  return v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}
function maskCNPJ(v: string) {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}
function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

export default function ConfigEmpresaPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cepLoading, setCepLoading] = useState(false)

  const [form, setForm] = useState({
    company_name: '', phone: '', email: '', cnpj: '',
    address_street: '', address_number: '', address_complement: '',
    address_neighborhood: '', address_city: '', address_state: '', address_zip: '',
    warranty_days: '90',
  })

  useEffect(() => {
    // Load from settings API
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        const data = d.data ?? {}
        // Settings are grouped, flatten them
        const flat: Record<string, string> = {}
        for (const group of Object.values(data) as any[]) {
          for (const [key, val] of Object.entries(group)) {
            flat[key] = (val as any)?.value ?? ''
          }
        }
        if (Object.keys(flat).length > 0) {
          setForm(prev => ({
            ...prev,
            company_name: flat['company_name'] || flat['empresa.nome'] || prev.company_name,
            phone: flat['phone'] || flat['empresa.telefone'] ? maskPhone(flat['phone'] || flat['empresa.telefone'] || '') : prev.phone,
            email: flat['email'] || flat['empresa.email'] || prev.email,
            cnpj: flat['cnpj'] || flat['empresa.cnpj'] ? maskCNPJ(flat['cnpj'] || flat['empresa.cnpj'] || '') : prev.cnpj,
            address_street: flat['address_street'] || flat['empresa.rua'] || prev.address_street,
            address_number: flat['address_number'] || flat['empresa.numero'] || prev.address_number,
            address_complement: flat['address_complement'] || flat['empresa.complemento'] || prev.address_complement,
            address_neighborhood: flat['address_neighborhood'] || flat['empresa.bairro'] || prev.address_neighborhood,
            address_city: flat['address_city'] || flat['empresa.cidade'] || prev.address_city,
            address_state: flat['address_state'] || flat['empresa.estado'] || prev.address_state,
            address_zip: flat['address_zip'] || flat['empresa.cep'] ? maskCEP(flat['address_zip'] || flat['empresa.cep'] || '') : prev.address_zip,
            warranty_days: flat['warranty_days'] || flat['empresa.garantia_dias'] || prev.warranty_days,
          }))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function update(field: string, value: string) { setForm(prev => ({ ...prev, [field]: value })) }

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
      } else { toast.error('CEP não encontrado') }
    } catch { toast.error('Erro ao consultar CEP') } finally { setCepLoading(false) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.company_name.trim()) { toast.error('Nome da empresa é obrigatório'); return }

    setSaving(true)
    try {
      // Convert flat form to settings array format
      const settings = Object.entries(form).map(([key, value]) => ({
        key,
        value: String(value),
        type: key === 'warranty_days' ? 'number' as const : 'string' as const,
        group: 'empresa',
      }))

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')

      toast.success('Dados da empresa salvos!')
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dados da Empresa</h1>
        <p className="text-sm text-gray-500 mt-1">Informações gerais da sua empresa</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Identificação</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome da Empresa *</label>
            <input type="text" value={form.company_name} onChange={e => update('company_name', e.target.value)}
              placeholder="Nome da empresa" required className={inp} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
            <input type="text" value={form.cnpj} onChange={e => update('cnpj', maskCNPJ(e.target.value))}
              placeholder="00.000.000/0001-00" className={inp + " font-mono"} />
          </div>
        </div>

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Contato</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input type="tel" value={form.phone} onChange={e => update('phone', maskPhone(e.target.value))}
                placeholder="(11) 3136-0415" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)}
                placeholder="contato@empresa.com" className={inp} />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Endereço</h2>
          <div className="flex gap-2">
            <div className="w-44">
              <label className="block text-sm font-medium text-gray-700 mb-1">CEP</label>
              <input type="text" value={form.address_zip}
                onChange={e => update('address_zip', maskCEP(e.target.value))}
                onBlur={() => { if (form.address_zip.replace(/\D/g, '').length === 8) searchCEP() }}
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

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Configurações</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dias de Garantia Padrão</label>
            <input type="number" min="0" value={form.warranty_days}
              onChange={e => update('warranty_days', e.target.value)}
              placeholder="90" className={inp + " max-w-xs"} />
            <p className="text-xs text-gray-400 mt-1">Aplicado automaticamente nas novas ordens de serviço</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => router.push('/config')}
            className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50 transition-colors">Voltar</button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </form>
    </div>
  )
}
