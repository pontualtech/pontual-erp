'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

interface Cliente {
  id: string
  legal_name: string
  trade_name: string | null
  person_type: string
  customer_type: string
  document_number: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_neighborhood: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  notes: string | null
  created_at: string
}

interface OS {
  id: string
  number: string
  status: string
  description: string | null
  total_amount: number
  created_at: string
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function ClienteDetalhePage() {
  const params = useParams()
  const id = params.id as string
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [ordens, setOrdens] = useState<OS[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/clientes/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setCliente(d.data ?? d)
        setOrdens(d.data?.orders ?? d.orders ?? [])
      })
      .catch(() => setError('Erro ao carregar cliente'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <div className="py-12 text-center text-gray-400">Carregando...</div>
  }

  if (error || !cliente) {
    return (
      <div className="py-12 text-center">
        <p className="text-red-500">{error || 'Cliente nao encontrado'}</p>
        <Link href="/clientes" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          Voltar para clientes
        </Link>
      </div>
    )
  }

  const endereco = [
    cliente.address_street,
    cliente.address_number,
    cliente.address_complement,
    cliente.address_neighborhood,
    cliente.address_city && cliente.address_state
      ? `${cliente.address_city}/${cliente.address_state}`
      : cliente.address_city,
    cliente.address_zip,
  ].filter(Boolean).join(', ')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/clientes" className="rounded-md border p-2 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cliente.legal_name}</h1>
          {cliente.trade_name && <p className="text-sm text-gray-500">{cliente.trade_name}</p>}
        </div>
      </div>

      {/* Dados do cliente */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Identificacao</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Tipo</span>
              <span className="text-gray-900">{cliente.person_type === 'FISICA' ? 'Pessoa Fisica' : 'Pessoa Juridica'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Classificacao</span>
              <span className="text-gray-900">{cliente.customer_type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{cliente.person_type === 'FISICA' ? 'CPF' : 'CNPJ'}</span>
              <span className="text-gray-900">{cliente.document_number || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Cadastrado em</span>
              <span className="text-gray-900">{new Date(cliente.created_at).toLocaleDateString('pt-BR')}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Contato</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span className="text-gray-900">{cliente.email || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Celular</span>
              <span className="text-gray-900">{cliente.mobile || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Telefone</span>
              <span className="text-gray-900">{cliente.phone || '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Endereco */}
      {endereco && (
        <div className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Endereco</h2>
          <p className="text-sm text-gray-700">{endereco}</p>
        </div>
      )}

      {/* Notas */}
      {cliente.notes && (
        <div className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Observacoes</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{cliente.notes}</p>
        </div>
      )}

      {/* Ordens de Servico */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Ordens de Servico</h2>
          <Link
            href={`/os/novo?cliente=${id}`}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Nova OS
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Numero</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Descricao</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ordens.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Nenhuma OS encontrada</td></tr>
              ) : (
                ordens.map(os => (
                  <tr key={os.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/os/${os.id}`} className="font-medium text-blue-600 hover:underline">
                        #{os.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {os.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{os.description || '—'}</td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(os.total_amount)}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(os.created_at).toLocaleDateString('pt-BR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
