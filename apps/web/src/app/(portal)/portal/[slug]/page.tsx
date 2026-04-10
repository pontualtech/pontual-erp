'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ThemeToggle } from '../../components/theme-toggle'

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

const FINAL_STATUSES = ['entregue', 'finalizado', 'cancelado']

function isOsFinal(os: PortalOS) {
  return FINAL_STATUSES.some(s => os.status.name.toLowerCase().includes(s))
}

function isOsAguardandoAprovacao(os: PortalOS) {
  const name = os.status.name.toLowerCase()
  return name.includes('aguardando') && name.includes('aprov')
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
    try { if (savedCustomer) setCustomer(JSON.parse(savedCustomer)) } catch {}
    try { if (savedCompany) setCompany(JSON.parse(savedCompany)) } catch {}

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
      .catch(() => {
        toast.error('Erro ao carregar ordens de servico. Tente novamente.')
      })
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

  const osEmAndamento = osList.filter(os => !isOsFinal(os) && !isOsAguardandoAprovacao(os))
  const osAguardandoAprovacao = osList.filter(isOsAguardandoAprovacao)
  const osConcluidas = osList.filter(isOsFinal)
  const firstName = customer?.name?.split(' ')[0] || 'Cliente'

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-200 dark:border-blue-900 border-t-blue-600 dark:border-t-blue-400" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      {/* Sticky Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 sticky top-0 z-50 shadow-sm dark:shadow-zinc-900/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Logo / Company */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 dark:bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
              </div>
              <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base truncate max-w-[140px] sm:max-w-none">
                {company?.name || slug}
              </span>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden sm:flex items-center gap-1">
              <Link
                href={`/portal/${slug}`}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950"
              >
                Inicio
              </Link>
              <Link
                href={`/portal/${slug}/os`}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Minhas OS
              </Link>
              <Link
                href={`/portal/${slug}/tickets`}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Tickets
              </Link>
              <Link
                href={`/portal/${slug}/financeiro`}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Financeiro
              </Link>
            </nav>

            {/* User / Theme / Logout */}
            <div className="flex items-center gap-1 sm:gap-2">
              <ThemeToggle />
              <Link href={`/portal/${slug}/perfil`} className="hidden sm:flex items-center gap-2 hover:opacity-80 transition-opacity" title="Meu Perfil">
                <div className="w-7 h-7 bg-gray-200 dark:bg-zinc-700 rounded-full flex items-center justify-center">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    {firstName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">{firstName}</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 font-medium px-2 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                Sair
              </button>
            </div>
          </div>

          {/* Mobile Nav */}
          <div className="sm:hidden border-t border-gray-100 dark:border-zinc-800 flex gap-1 py-1.5 -mx-1">
            <Link
              href={`/portal/${slug}`}
              className="flex-1 text-center px-2 py-1.5 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950"
            >
              Inicio
            </Link>
            <Link
              href={`/portal/${slug}/os`}
              className="flex-1 text-center px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
            >
              Minhas OS
            </Link>
            <Link
              href={`/portal/${slug}/tickets`}
              className="flex-1 text-center px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
            >
              Tickets
            </Link>
            <Link
              href={`/portal/${slug}/financeiro`}
              className="flex-1 text-center px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
            >
              Financeiro
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Priority Banner - Aguardando Aprovacao */}
        {osAguardandoAprovacao.length > 0 && (
          <div className="rounded-xl border-2 border-red-200 dark:border-red-900 bg-gradient-to-r from-red-50 to-amber-50 dark:from-red-950 dark:to-amber-950 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-red-800 dark:text-red-300 text-base sm:text-lg">
                  Voce tem {osAguardandoAprovacao.length} orcamento{osAguardandoAprovacao.length > 1 ? 's' : ''} aguardando sua decisao!
                </h3>
                <p className="text-sm text-red-700 dark:text-red-400 mt-0.5">
                  Aprove agora para evitar atrasos no reparo do seu equipamento.
                </p>
                <div className="mt-3 space-y-2">
                  {osAguardandoAprovacao.map(os => (
                    <Link
                      key={os.id}
                      href={`/portal/${slug}/os/${os.id}`}
                      className="flex items-center justify-between bg-white dark:bg-zinc-900 rounded-lg p-3 hover:bg-red-50 dark:hover:bg-red-950 transition-colors border border-red-100 dark:border-red-900 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">OS #{os.os_number}</span>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{os.equipment_type}{os.equipment_brand ? ` - ${os.equipment_brand}` : ''}{os.equipment_model ? ` ${os.equipment_model}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        {os.total_cost ? (
                          <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">
                            R$ {(os.total_cost / 100).toFixed(2)}
                          </span>
                        ) : null}
                        <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900 px-2 py-1 rounded-full group-hover:bg-red-200 dark:group-hover:bg-red-800 transition-colors">
                          Aprovar
                        </span>
                        <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Welcome */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
            Ola, {firstName}!
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-0.5 text-sm sm:text-base">Bem-vindo ao Portal do Cliente</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {/* Em Andamento */}
          <Link
            href={`/portal/${slug}/os?filter=andamento`}
            className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 sm:p-5 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all group cursor-pointer"
          >
            <div className="flex flex-col items-center sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-10 h-10 sm:w-11 sm:h-11 bg-blue-100 dark:bg-blue-950 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 dark:group-hover:bg-blue-900 transition-colors">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="text-center sm:text-left">
                <p className="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">{osEmAndamento.length}</p>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">Em Andamento</p>
              </div>
            </div>
          </Link>

          {/* Aguardando Aprovacao */}
          <Link
            href={`/portal/${slug}/os?filter=aprovacao`}
            className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 sm:p-5 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-md transition-all group cursor-pointer"
          >
            <div className="flex flex-col items-center sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-10 h-10 sm:w-11 sm:h-11 bg-amber-100 dark:bg-amber-950 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-amber-200 dark:group-hover:bg-amber-900 transition-colors">
                <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-center sm:text-left">
                <p className="text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400">{osAguardandoAprovacao.length}</p>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">Aguardando Aprovacao</p>
              </div>
            </div>
          </Link>

          {/* Concluidas */}
          <Link
            href={`/portal/${slug}/os?filter=concluidas`}
            className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 sm:p-5 hover:border-green-300 dark:hover:border-green-700 hover:shadow-md transition-all group cursor-pointer"
          >
            <div className="flex flex-col items-center sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-10 h-10 sm:w-11 sm:h-11 bg-green-100 dark:bg-green-950 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-green-200 dark:group-hover:bg-green-900 transition-colors">
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-center sm:text-left">
                <p className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400">{osConcluidas.length}</p>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">Concluidas</p>
              </div>
            </div>
          </Link>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href={`/portal/${slug}/nova-os`}
            className="flex items-center justify-center gap-2 bg-green-600 text-white font-semibold py-3 px-5 rounded-xl hover:bg-green-700 transition-colors text-sm shadow-sm hover:shadow-md"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Abrir Nova OS
          </Link>
          <Link
            href={`/portal/${slug}/os`}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-3 px-5 rounded-xl hover:bg-blue-700 transition-colors text-sm shadow-sm hover:shadow-md"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Consultar OS
          </Link>
          <Link
            href={`/portal/${slug}/tickets`}
            className="flex items-center justify-center gap-2 bg-gray-600 text-white font-semibold py-3 px-5 rounded-xl hover:bg-gray-700 transition-colors text-sm shadow-sm hover:shadow-md"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            Abrir Ticket
          </Link>
          <Link
            href={`/portal/${slug}/suporte-ia`}
            className="flex items-center justify-center gap-2 bg-violet-600 text-white font-semibold py-3 px-5 rounded-xl hover:bg-violet-700 transition-colors text-sm shadow-sm hover:shadow-md"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Suporte IA
          </Link>
        </div>

        {/* Recent OS */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Ordens de Servico Recentes</h2>
            <Link
              href={`/portal/${slug}/os`}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
            >
              Ver todas
            </Link>
          </div>

          {osList.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-12 h-12 bg-gray-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma ordem de servico encontrada</p>
              <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Suas OS aparecerão aqui quando criadas.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden sm:block">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-zinc-800/50 border-b border-gray-100 dark:border-zinc-800">
                    <tr>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">Numero</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">Equipamento</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">Status</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">Data</th>
                      <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-5 py-3">Acao</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                    {osList.slice(0, 5).map(os => (
                      <tr key={os.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">#{os.os_number}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            {os.equipment_type}
                            {os.equipment_brand && ` - ${os.equipment_brand}`}
                            {os.equipment_model && ` ${os.equipment_model}`}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
                            style={{
                              backgroundColor: `${os.status.color}20`,
                              color: os.status.color,
                            }}
                          >
                            {os.status.name}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {new Date(os.created_at).toLocaleDateString('pt-BR')}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Link
                            href={`/portal/${slug}/os/${os.id}`}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium hover:underline"
                          >
                            Ver detalhes
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="sm:hidden divide-y divide-gray-100 dark:divide-zinc-800">
                {osList.slice(0, 5).map(os => (
                  <Link
                    key={os.id}
                    href={`/portal/${slug}/os/${os.id}`}
                    className="block px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">#{os.os_number}</span>
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{
                          backgroundColor: `${os.status.color}20`,
                          color: os.status.color,
                        }}
                      >
                        {os.status.name}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {os.equipment_type}
                      {os.equipment_brand && ` - ${os.equipment_brand}`}
                      {os.equipment_model && ` ${os.equipment_model}`}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(os.created_at).toLocaleDateString('pt-BR')}
                      </span>
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Ver detalhes</span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 mt-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
