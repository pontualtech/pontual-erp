'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

const EQUIPMENT_TYPES = [
  'Impressora',
  'Multifuncional',
  'Notebook',
  'Desktop',
  'Monitor',
  'Scanner',
  'Nobreak',
  'Servidor',
  'Roteador',
  'Switch',
  'Outro',
]

export default function PortalNovaOSPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [company, setCompany] = useState<{ name: string } | null>(null)
  const [customer, setCustomer] = useState<{ name: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    equipment_type: '',
    brand: '',
    model: '',
    serial_number: '',
    reported_issue: '',
    preferred_date: '',
  })

  useEffect(() => {
    const savedCompany = localStorage.getItem('portal_company')
    const savedCustomer = localStorage.getItem('portal_customer')
    if (savedCompany) setCompany(JSON.parse(savedCompany))
    if (savedCustomer) setCustomer(JSON.parse(savedCustomer))
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!form.equipment_type) {
      setError('Selecione o tipo de equipamento')
      return
    }
    if (!form.reported_issue.trim()) {
      setError('Descreva o problema do equipamento')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (res.status === 401) {
        router.push(`/portal/${slug}/login`)
        return
      }

      const json = await res.json()

      if (!res.ok) {
        setError(json.error || 'Erro ao criar ordem de servico')
        return
      }

      // Redirect to the created OS detail page
      router.push(`/portal/${slug}/os/${json.data.id}`)
    } catch {
      setError('Erro de conexao. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('portal_customer')
    localStorage.removeItem('portal_company')
    fetch('/api/portal/logout', { method: 'POST' })
      .finally(() => router.push(`/portal/${slug}/login`))
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 dark:bg-blue-500 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{company?.name || slug}</span>
          </div>

          <nav className="hidden sm:flex items-center gap-6">
            <Link href={`/portal/${slug}`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">
              Inicio
            </Link>
            <Link href={`/portal/${slug}/os`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">
              Minhas OS
            </Link>
            <Link href={`/portal/${slug}/tickets`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">
              Tickets
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:block">{customer?.name}</span>
            <button onClick={handleLogout} className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium">
              Sair
            </button>
          </div>
        </div>
        <div className="sm:hidden border-t border-gray-100 dark:border-zinc-800 px-4 py-2 flex gap-4">
          <Link href={`/portal/${slug}`} className="text-gray-600 text-sm">Inicio</Link>
          <Link href={`/portal/${slug}/os`} className="text-gray-600 text-sm">Minhas OS</Link>
          <Link href={`/portal/${slug}/tickets`} className="text-gray-600 text-sm">Tickets</Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="mb-6">
          <Link
            href={`/portal/${slug}/os`}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium inline-flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Voltar para Minhas OS
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">Nova Ordem de Servico</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Preencha os dados do equipamento e descreva o problema</p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-6 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 space-y-5">
          {/* Equipment Type */}
          <div>
            <label htmlFor="equipment_type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Tipo de Equipamento *
            </label>
            <select
              id="equipment_type"
              name="equipment_type"
              value={form.equipment_type}
              onChange={handleChange}
              className="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">Selecione...</option>
              {EQUIPMENT_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          {/* Brand & Model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="brand" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Marca
              </label>
              <input
                type="text"
                id="brand"
                name="brand"
                value={form.brand}
                onChange={handleChange}
                placeholder="Ex: HP, Epson, Dell"
                className="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label htmlFor="model" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Modelo
              </label>
              <input
                type="text"
                id="model"
                name="model"
                value={form.model}
                onChange={handleChange}
                placeholder="Ex: LaserJet Pro M404n"
                className="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>

          {/* Serial Number */}
          <div>
            <label htmlFor="serial_number" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Numero de Serie
            </label>
            <input
              type="text"
              id="serial_number"
              name="serial_number"
              value={form.serial_number}
              onChange={handleChange}
              placeholder="Opcional"
              className="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Reported Issue */}
          <div>
            <label htmlFor="reported_issue" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Descricao do Problema *
            </label>
            <textarea
              id="reported_issue"
              name="reported_issue"
              value={form.reported_issue}
              onChange={handleChange}
              rows={4}
              placeholder="Descreva o defeito ou problema do equipamento com o maximo de detalhes possivel..."
              className="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          {/* Preferred Date */}
          <div>
            <label htmlFor="preferred_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Data Preferencial para Atendimento
            </label>
            <input
              type="date"
              id="preferred_date"
              name="preferred_date"
              value={form.preferred_date}
              onChange={handleChange}
              min={new Date().toISOString().split('T')[0]}
              className="w-full border border-gray-300 dark:border-zinc-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Opcional - sujeito a disponibilidade</p>
          </div>

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white font-medium py-3 px-4 rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Criando...
                </span>
              ) : (
                'Abrir Ordem de Servico'
              )}
            </button>
          </div>
        </form>
      </main>

      <footer className="border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 mt-12">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
