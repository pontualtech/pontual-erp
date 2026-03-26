'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface EmpresaSettings {
  company_name: string
  phone: string
  email: string
  cnpj: string
  address_street: string
  address_number: string
  address_complement: string
  address_neighborhood: string
  address_city: string
  address_state: string
  address_zip: string
  warranty_days: number
}

export default function ConfigEmpresaPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState<EmpresaSettings>({
    company_name: '',
    phone: '',
    email: '',
    cnpj: '',
    address_street: '',
    address_number: '',
    address_complement: '',
    address_neighborhood: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    warranty_days: 90,
  })

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        const s = d.data ?? d
        if (s) {
          setForm(prev => ({
            ...prev,
            ...Object.fromEntries(
              Object.entries(s).filter(([_, v]) => v !== null && v !== undefined)
            ),
          }))
        }
      })
      .catch(() => toast.error('Erro ao carregar configuracoes'))
      .finally(() => setLoading(false))
  }, [])

  function updateForm(field: string, value: string | number) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')

      toast.success('Configuracoes salvas!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-gray-400">Carregando...</div>
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dados da Empresa</h1>
        <p className="text-sm text-gray-500 mt-1">Informacoes gerais da sua empresa</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Dados principais */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Identificacao</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Nome da Empresa *</label>
            <input type="text" value={form.company_name} onChange={e => updateForm('company_name', e.target.value)}
              required className="w-full px-3 py-2 border rounded-md" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">CNPJ</label>
            <input type="text" value={form.cnpj} onChange={e => updateForm('cnpj', e.target.value)}
              placeholder="00.000.000/0001-00" className="w-full px-3 py-2 border rounded-md" />
          </div>
        </div>

        {/* Contato */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Contato</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Telefone</label>
              <input type="tel" value={form.phone} onChange={e => updateForm('phone', e.target.value)}
                placeholder="(11) 3136-0415" className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
          </div>
        </div>

        {/* Endereco */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Endereco</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Rua</label>
              <input type="text" value={form.address_street} onChange={e => updateForm('address_street', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Numero</label>
              <input type="text" value={form.address_number} onChange={e => updateForm('address_number', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Complemento</label>
              <input type="text" value={form.address_complement} onChange={e => updateForm('address_complement', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Bairro</label>
              <input type="text" value={form.address_neighborhood} onChange={e => updateForm('address_neighborhood', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">CEP</label>
              <input type="text" value={form.address_zip} onChange={e => updateForm('address_zip', e.target.value)}
                placeholder="00000-000" className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Cidade</label>
              <input type="text" value={form.address_city} onChange={e => updateForm('address_city', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Estado</label>
              <input type="text" value={form.address_state} onChange={e => updateForm('address_state', e.target.value)}
                placeholder="SP" maxLength={2} className="w-full px-3 py-2 border rounded-md" />
            </div>
          </div>
        </div>

        {/* Configuracoes */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Configuracoes</h2>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Dias de Garantia Padrao</label>
            <input type="number" min="0" value={form.warranty_days}
              onChange={e => updateForm('warranty_days', parseInt(e.target.value || '0', 10))}
              className="w-full px-3 py-2 border rounded-md max-w-xs" />
            <p className="text-xs text-gray-400 mt-1">Aplicado automaticamente nas novas ordens de servico</p>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.push('/config')}
            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50">Voltar</button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saving ? 'Salvando...' : 'Salvar Configuracoes'}
          </button>
        </div>
      </form>
    </div>
  )
}
