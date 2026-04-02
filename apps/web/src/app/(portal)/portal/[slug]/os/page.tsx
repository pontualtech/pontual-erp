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
  diagnosis?: string
  total_cost?: number
  estimated_delivery?: string
  created_at: string
  status: { id: string; name: string; color: string }
}

export default function PortalOSListPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [osList, setOsList] = useState<PortalOS[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [company, setCompany] = useState<{ name: string } | null>(null)
  const [customer, setCustomer] = useState<{ name: string } | null>(null)

  useEffect(() => {
    const savedCompany = localStorage.getItem('portal_company')
    const savedCustomer = localStorage.getItem('portal_customer')
    if (savedCompany) setCompany(JSON.parse(savedCompany))
    if (savedCustomer) setCustomer(JSON.parse(savedCustomer))
  }, [slug, router])

  useEffect(() => {
    setLoading(true)
    // Auth token is sent automatically via httpOnly cookie
    fetch(`/api/portal/os?page=${page}&limit=20`)
      .then(r => {
        if (r.status === 401) {
          router.push(`/portal/${slug}/login`)
          return null
        }
        return r.json()
      })
      .then(res => {
        if (res?.data) {
          setOsList(res.data)
          setTotal(res.total)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, slug, router])

  function handleLogout() {
    localStorage.removeItem('portal_customer')
    localStorage.removeItem('portal_company')
    fetch('/api/portal/logout', { method: 'POST' })
      .finally(() => router.push(`/portal/${slug}/login`))
  }

  const totalPages = Math.ceil(total / 20)

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
            <Link href={`/portal/${slug}`} className="text-gray-600 hover:text-gray-900 text-sm">
              Inicio
            </Link>
            <Link href={`/portal/${slug}/os`} className="text-blue-600 font-medium text-sm">
              Minhas OS
            </Link>
            <Link href={`/portal/${slug}/tickets`} className="text-gray-600 hover:text-gray-900 text-sm">
              Tickets
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden sm:block">{customer?.name}</span>
            <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-700 font-medium">
              Sair
            </button>
          </div>
        </div>
        <div className="sm:hidden border-t border-gray-100 px-4 py-2 flex gap-4">
          <Link href={`/portal/${slug}`} className="text-gray-600 text-sm">Inicio</Link>
          <Link href={`/portal/${slug}/os`} className="text-blue-600 font-medium text-sm">Minhas OS</Link>
          <Link href={`/portal/${slug}/tickets`} className="text-gray-600 text-sm">Tickets</Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Minhas Ordens de Servico</h1>
          <span className="text-sm text-gray-500">{total} OS encontradas</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : osList.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-gray-500">Nenhuma ordem de servico encontrada</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">#</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Equipamento</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Data</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {osList.map(os => (
                    <tr
                      key={os.id}
                      onClick={() => router.push(`/portal/${slug}/os/${os.id}`)}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-4 font-medium text-gray-900">{os.os_number}</td>
                      <td className="px-5 py-4">
                        <div className="text-gray-900">{os.equipment_type}</div>
                        {(os.equipment_brand || os.equipment_model) && (
                          <div className="text-sm text-gray-500">
                            {os.equipment_brand} {os.equipment_model}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                          style={{
                            backgroundColor: `${os.status.color}20`,
                            color: os.status.color,
                          }}
                        >
                          {os.status.name}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-500">
                        {new Date(os.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900">
                        {os.total_cost ? `R$ ${(os.total_cost / 100).toFixed(2)}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {osList.map(os => (
                <Link
                  key={os.id}
                  href={`/portal/${slug}/os/${os.id}`}
                  className="block bg-white rounded-xl border border-gray-200 p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900">OS #{os.os_number}</span>
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
                  <p className="text-sm text-gray-600">{os.equipment_type}</p>
                  <div className="flex items-center justify-between mt-2 text-sm">
                    <span className="text-gray-500">
                      {new Date(os.created_at).toLocaleDateString('pt-BR')}
                    </span>
                    {os.total_cost ? (
                      <span className="font-medium text-gray-900">
                        R$ {(os.total_cost / 100).toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
                >
                  Anterior
                </button>
                <span className="text-sm text-gray-600">
                  Pagina {page} de {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
                >
                  Proxima
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-400">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
