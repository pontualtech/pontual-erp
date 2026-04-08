'use client'

import { useState, useEffect, useMemo } from 'react'
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
  status: { id: string; name: string; color: string; is_final?: boolean }
}

type StatusFilter = 'todas' | 'em_andamento' | 'aguardando' | 'concluidas'

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'em_andamento', label: 'Em Andamento' },
  { key: 'aguardando', label: 'Aguardando Aprovacao' },
  { key: 'concluidas', label: 'Concluidas' },
]

function classifyStatus(os: PortalOS): StatusFilter {
  const name = os.status.name.toLowerCase()
  if (name.includes('aguardando aprov') || name.includes('analise')) {
    return 'aguardando'
  }
  if (os.status.is_final || name.includes('entreg') || name.includes('cancelad') || name.includes('finaliz')) {
    return 'concluidas'
  }
  return 'em_andamento'
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
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas')

  useEffect(() => {
    const savedCompany = localStorage.getItem('portal_company')
    const savedCustomer = localStorage.getItem('portal_customer')
    if (savedCompany) setCompany(JSON.parse(savedCompany))
    if (savedCustomer) setCustomer(JSON.parse(savedCustomer))
  }, [slug, router])

  useEffect(() => {
    setLoading(true)
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

  const filteredList = useMemo(() => {
    let list = osList

    // Status filter
    if (statusFilter !== 'todas') {
      list = list.filter(os => classifyStatus(os) === statusFilter)
    }

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(os => {
        const osNum = String(os.os_number)
        const equip = `${os.equipment_type} ${os.equipment_brand || ''} ${os.equipment_model || ''}`.toLowerCase()
        return osNum.includes(q) || equip.includes(q)
      })
    }

    return list
  }, [osList, statusFilter, search])

  const totalPages = Math.ceil(total / 20)

  const statusCounts = useMemo(() => {
    const counts = { todas: osList.length, em_andamento: 0, aguardando: 0, concluidas: 0 }
    osList.forEach(os => {
      const cat = classifyStatus(os)
      counts[cat]++
    })
    return counts
  }, [osList])

  function formatEquipment(os: PortalOS) {
    const parts = [os.equipment_type]
    if (os.equipment_brand) parts.push(os.equipment_brand)
    if (os.equipment_model) parts.push(os.equipment_model)
    return parts.join(' ')
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('pt-BR')
  }

  function formatCurrency(cents?: number) {
    if (!cents) return '-'
    return `R$ ${(cents / 100).toFixed(2)}`
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700 sticky top-0 z-10">
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
            <Link href={`/portal/${slug}/os`} className="text-blue-600 dark:text-blue-400 font-medium text-sm">
              Minhas OS
            </Link>
            <Link href={`/portal/${slug}/tickets`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">
              Tickets
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:block">{customer?.name}</span>
            <button onClick={handleLogout} className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 font-medium">
              Sair
            </button>
          </div>
        </div>
        <div className="sm:hidden border-t border-gray-100 dark:border-zinc-800 px-4 py-2 flex gap-4">
          <Link href={`/portal/${slug}`} className="text-gray-600 dark:text-gray-400 text-sm">Inicio</Link>
          <Link href={`/portal/${slug}/os`} className="text-blue-600 dark:text-blue-400 font-medium text-sm">Minhas OS</Link>
          <Link href={`/portal/${slug}/tickets`} className="text-gray-600 dark:text-gray-400 text-sm">Tickets</Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Title + Nova OS */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Minhas Ordens de Servico</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{total} OS encontradas</p>
          </div>
          <Link
            href={`/portal/${slug}/nova-os`}
            className="inline-flex items-center gap-1.5 bg-blue-600 dark:bg-blue-500 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-blue-700 transition-colors text-sm shadow-sm dark:shadow-zinc-900/50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nova OS
          </Link>
        </div>

        {/* Search bar */}
        <div className="relative mb-4">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            placeholder="Buscar por numero da OS ou equipamento..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              title="Limpar busca"
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 mb-5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          {STATUS_TABS.map(tab => {
            const isActive = statusFilter === tab.key
            const count = statusCounts[tab.key]
            return (
              <button
                type="button"
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800/50'
                }`}
              >
                {tab.label}
                <span
                  className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold ${
                    isActive ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400" />
          </div>
        ) : osList.length === 0 ? (
          /* Empty state: no OS at all */
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-12 text-center">
            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-950 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Voce ainda nao tem ordens de servico</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-5">Abra sua primeira OS!</p>
            <Link
              href={`/portal/${slug}/nova-os`}
              className="inline-flex items-center gap-1.5 bg-blue-600 dark:bg-blue-500 text-white font-medium py-2.5 px-5 rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Abrir Nova OS
            </Link>
          </div>
        ) : filteredList.length === 0 ? (
          /* Empty state: filter returns nothing */
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-12 text-center">
            <div className="w-16 h-16 bg-gray-50 dark:bg-zinc-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Nenhuma OS encontrada para este filtro</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">Tente alterar os termos da busca ou o filtro de status</p>
            <button
              type="button"
              onClick={() => { setSearch(''); setStatusFilter('todas') }}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden hidden md:block shadow-sm dark:shadow-zinc-900/50">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Numero OS</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Equipamento</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Data Abertura</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Previsao</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {filteredList.map(os => (
                    <tr
                      key={os.id}
                      onClick={() => router.push(`/portal/${slug}/os/${os.id}`)}
                      className="hover:bg-blue-50/50 dark:hover:bg-blue-950/50 cursor-pointer transition-colors group"
                    >
                      <td className="px-5 py-4">
                        <span className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          #{os.os_number}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-gray-900 dark:text-gray-100">{os.equipment_type}</div>
                        {(os.equipment_brand || os.equipment_model) && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
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
                      <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(os.created_at)}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {os.estimated_delivery ? formatDate(os.estimated_delivery) : '-'}
                      </td>
                      <td className="px-5 py-4 text-right font-medium text-gray-900 dark:text-gray-100">
                        {formatCurrency(os.total_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filteredList.map(os => (
                <Link
                  key={os.id}
                  href={`/portal/${slug}/os/${os.id}`}
                  className="block bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-sm dark:hover:shadow-zinc-900/50 transition-all active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg font-bold text-gray-900 dark:text-gray-100">OS #{os.os_number}</span>
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
                  <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{formatEquipment(os)}</p>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
                    <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {formatDate(os.created_at)}
                    </div>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {formatCurrency(os.total_cost)}
                    </span>
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
                  className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-zinc-700 rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  Anterior
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400 px-2">
                  Pagina {page} de {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-zinc-700 rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  Proxima
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 mt-12">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
