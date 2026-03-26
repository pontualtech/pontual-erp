'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function NovoClientePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [personType, setPersonType] = useState('FISICA')

  const [form, setForm] = useState({
    legal_name: '',
    trade_name: '',
    person_type: 'FISICA',
    customer_type: 'CLIENTE',
    document_number: '',
    email: '',
    phone: '',
    mobile: '',
    address_street: '',
    address_number: '',
    address_complement: '',
    address_neighborhood: '',
    address_city: 'São Paulo',
    address_state: 'SP',
    address_zip: '',
    notes: '',
  })

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (field === 'person_type') setPersonType(value)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.legal_name) { toast.error('Nome é obrigatório'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      toast.success('Cliente cadastrado!')
      router.push('/clientes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Novo Cliente</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Tipo */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Identificação</h2>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" name="person_type" value="FISICA" checked={personType === 'FISICA'}
                onChange={e => updateForm('person_type', e.target.value)} />
              <span className="text-sm">Pessoa Física</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="person_type" value="JURIDICA" checked={personType === 'JURIDICA'}
                onChange={e => updateForm('person_type', e.target.value)} />
              <span className="text-sm">Pessoa Jurídica</span>
            </label>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" name="customer_type" value="CLIENTE" checked={form.customer_type === 'CLIENTE'}
                onChange={e => updateForm('customer_type', e.target.value)} />
              <span className="text-sm">Cliente</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="customer_type" value="FORNECEDOR" checked={form.customer_type === 'FORNECEDOR'}
                onChange={e => updateForm('customer_type', e.target.value)} />
              <span className="text-sm">Fornecedor</span>
            </label>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              {personType === 'FISICA' ? 'Nome completo *' : 'Razão Social *'}
            </label>
            <input type="text" value={form.legal_name} onChange={e => updateForm('legal_name', e.target.value)}
              required className="w-full px-3 py-2 border rounded-md" />
          </div>
          {personType === 'JURIDICA' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Nome Fantasia</label>
              <input type="text" value={form.trade_name} onChange={e => updateForm('trade_name', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              {personType === 'FISICA' ? 'CPF' : 'CNPJ'}
            </label>
            <input type="text" value={form.document_number} onChange={e => updateForm('document_number', e.target.value)}
              placeholder={personType === 'FISICA' ? '000.000.000-00' : '00.000.000/0001-00'}
              className="w-full px-3 py-2 border rounded-md" />
          </div>
        </div>

        {/* Contato */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Contato</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Celular</label>
              <input type="tel" value={form.mobile} onChange={e => updateForm('mobile', e.target.value)}
                placeholder="(11) 99999-0000" className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Telefone</label>
              <input type="tel" value={form.phone} onChange={e => updateForm('phone', e.target.value)}
                placeholder="(11) 3136-0415" className="w-full px-3 py-2 border rounded-md" />
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Endereço</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Rua</label>
              <input type="text" value={form.address_street} onChange={e => updateForm('address_street', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Número</label>
              <input type="text" value={form.address_number} onChange={e => updateForm('address_number', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Bairro</label>
              <input type="text" value={form.address_neighborhood} onChange={e => updateForm('address_neighborhood', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Cidade</label>
              <input type="text" value={form.address_city} onChange={e => updateForm('address_city', e.target.value)}
                className="w-full px-3 py-2 border rounded-md" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">CEP</label>
              <input type="text" value={form.address_zip} onChange={e => updateForm('address_zip', e.target.value)}
                placeholder="00000-000" className="w-full px-3 py-2 border rounded-md" />
            </div>
          </div>
        </div>

        {/* Observações */}
        <div className="rounded-lg border bg-white p-5">
          <label className="block text-sm text-gray-600 mb-1">Observações</label>
          <textarea value={form.notes} onChange={e => updateForm('notes', e.target.value)}
            rows={2} className="w-full px-3 py-2 border rounded-md resize-none" />
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={loading}
            className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">
            {loading ? 'Salvando...' : 'Cadastrar Cliente'}
          </button>
        </div>
      </form>
    </div>
  )
}
