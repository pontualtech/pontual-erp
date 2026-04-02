'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface PortalOS {
  id: string
  os_number: number
  equipment_type: string
  equipment_brand?: string
  equipment_model?: string
  reported_issue: string
  total_cost?: number
  created_at: string
  status: { id: string; name: string; color: string }
}

export default function PortalDashboardPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [osList, setOsList] = useState<PortalOS[]>([])
  const [loading, setLoading] = useState(true)
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)
  const [company, setCompany] = useState<{ id: string; name: string; slug: string } | null>(null)

  useEffect(() => {
    const savedCustomer = localStorage.getItem('portal_customer')
    const savedCompany = localStorage.getItem('portal_company')
    if (savedCustomer) setCustomer(JSON.parse(savedCustomer))
    if (savedCompany) setCompany(JSON.parse(savedCompany))

    // Auth token is sent automatically via httpOnly cookie
    fetch('/api/portal/os?limit=10')
      .then(r => {
        if (r.status === 401) {
          router.push(`/portal/${slug}/login`)
          return null
        }
        return r.json()
      })
      .then(res => {
        if (res?.data) setOsList(res.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [slug, router])

  function handleLogout() {
    // Clear display data from localStorage
    localStorage.removeItem('portal_customer')
    localStorage.removeItem('portal_company')
    // Logout clears the httpOnly cookie server-side
    fetch('/api/portal/logout', { method: 'POST' })
      .finally(() => router.push(`/portal/${slug}/login`))
  }

  const osEmAndamento = osList.filter(
    os => !['Entregue', 'Finalizado', 'Cancelado'].some(s =>
      os.status.name.toLowerCase().includes(s.toLowerCase())
    )
  )
  const osAguardandoAprovacao = osList.filter(os =>
    os.status.name.toLowerCase().includes('aguardando') &&
    os.status.name.toLowerCase().includes('aprov')
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900">{company?.name || slug}</span>
          </div>

          <nav className="hidden sm:flex items-center gap-6">
            <Link href={`/portal/${slug}`} className="text-blue-600 font-medium text-sm">
              Inicio
            </Link>
            <Link href={`/portal/${slug}/os`} className="text-gray-600 hover:text-gray-900 text-sm">
              Minhas OS
            </Link>
            <Link href={`/portal/${slug}/tickets`} className="text-gray-600 hover:text-gray-900 text-sm">
              Tickets
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">{customer?.name}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="sm:hidden border-t border-gray-100 px-4 py-2 flex gap-4">
          <Link href={`/portal/${slug}`} className="text-blue-600 font-medium text-sm">
            Inicio
          </Link>
          <Link href={`/portal/${slug}/os`} className="text-gray-600 text-sm">
            Minhas OS
          </Link>
          <Link href={`/portal/${slug}/tickets`} className="text-gray-600 text-sm">
            Tickets
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Welcome */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Ola, {customer?.name?.split(' ')[0] || 'Cliente'}!
          </h1>
          <p className="text-gray-500 mt-1">Acompanhe suas ordens de servico</p>
        </div>

        {/* Action button */}
        <div className="mb-6">
          <Link
            href={`/portal/${slug}/nova-os`}
            className="inline-flex items-center gap-2 bg-blue-600 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nova Ordem de Servico
          </Link>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{osList.length}</p>
                <p className="text-sm text-gray-500">Total de OS</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{osEmAndamento.length}</p>
                <p className="text-sm text-gray-500">Em andamento</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{osAguardandoAprovacao.length}</p>
                <p className="text-sm text-gray-500">Aguardando aprovacao</p>
              </div>
            </div>
          </div>
        </div>

        {/* Aguardando aprovacao highlight */}
        {osAguardandoAprovacao.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <h3 className="font-semibold text-amber-900 flex items-center gap-2 mb-3">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Orcamentos aguardando sua aprovacao
            </h3>
            {osAguardandoAprovacao.map(os => (
              <Link
                key={os.id}
                href={`/portal/${slug}/os/${os.id}`}
                className="flex items-center justify-between bg-white rounded-lg p-3 mb-2 last:mb-0 hover:bg-amber-50 transition-colors border border-amber-100"
              >
                <div>
                  <span className="font-medium text-gray-900">OS #{os.os_number}</span>
                  <span className="text-gray-500 ml-2 text-sm">{os.equipment_type}</span>
                </div>
                <div className="text-right">
                  {os.total_cost ? (
                    <span className="font-semibold text-gray-900">
                      R$ {(os.total_cost / 100).toFixed(2)}
                    </span>
                  ) : null}
                  <svg className="w-4 h-4 text-gray-400 inline ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Recent OS */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Ordens de Servico Recentes</h2>
            <Link href={`/portal/${slug}/os`} className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Ver todas
            </Link>
          </div>

          {osList.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              Nenhuma ordem de servico encontrada
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {osList.slice(0, 5).map(os => (
                <Link
                  key={os.id}
                  href={`/portal/${slug}/os/${os.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">#{os.os_number}</span>
                      <span
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: `${os.status.color}20`,
                          color: os.status.color,
                        }}
                      >
                        {os.status.name}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">
                      {os.equipment_type}
                      {os.equipment_brand && ` - ${os.equipment_brand}`}
                      {os.equipment_model && ` ${os.equipment_model}`}
                    </p>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <p className="text-sm text-gray-500">
                      {new Date(os.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-400">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
