'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

interface PortalTicket {
  id: string
  ticket_number: number
  subject: string
  description?: string
  status?: string
  priority?: string
  category?: string
  service_order?: { os_number: number; equipment_type: string } | null
  created_at: string
  updated_at: string
}

interface PortalOS {
  id: string
  os_number: number
  equipment_type: string
}

export default function PortalTicketsPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [tickets, setTickets] = useState<PortalTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newOsId, setNewOsId] = useState('')
  const [osList, setOsList] = useState<PortalOS[]>([])
  const [creating, setCreating] = useState(false)
  const [company, setCompany] = useState<{ name: string } | null>(null)
  const [customer, setCustomer] = useState<{ name: string } | null>(null)

  function loadTickets() {
    // Auth token is sent automatically via httpOnly cookie
    fetch('/api/portal/tickets')
      .then(r => {
        if (r.status === 401) {
          router.push(`/portal/${slug}/login`)
          return null
        }
        return r.json()
      })
      .then(res => {
        if (res?.data) setTickets(res.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const savedCompany = localStorage.getItem('portal_company')
    const savedCustomer = localStorage.getItem('portal_customer')
    if (savedCompany) setCompany(JSON.parse(savedCompany))
    if (savedCustomer) setCustomer(JSON.parse(savedCustomer))

    loadTickets()

    // Carregar OS para vincular ao ticket
    fetch('/api/portal/os?limit=50')
      .then(r => r.json())
      .then(res => {
        if (res?.data) setOsList(res.data)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault()
    if (!newSubject.trim()) {
      toast.error('Informe o assunto')
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/api/portal/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: newSubject,
          description: newDescription,
          service_order_id: newOsId || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao criar ticket')
        return
      }

      toast.success(`Ticket #${data.data.ticket_number} criado!`)
      setShowNew(false)
      setNewSubject('')
      setNewDescription('')
      setNewOsId('')
      loadTickets()
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setCreating(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('portal_customer')
    localStorage.removeItem('portal_company')
    fetch('/api/portal/logout', { method: 'POST' })
      .finally(() => router.push(`/portal/${slug}/login`))
  }

  const statusColors: Record<string, string> = {
    ABERTO: '#3B82F6',
    EM_ANDAMENTO: '#F59E0B',
    AGUARDANDO_CLIENTE: '#EF4444',
    RESOLVIDO: '#10B981',
    FECHADO: '#6B7280',
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
            <Link href={`/portal/${slug}`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">Inicio</Link>
            <Link href={`/portal/${slug}/os`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">Minhas OS</Link>
            <Link href={`/portal/${slug}/tickets`} className="text-blue-600 dark:text-blue-400 font-medium text-sm">Tickets</Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:block">{customer?.name}</span>
            <button onClick={handleLogout} className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium">Sair</button>
          </div>
        </div>
        <div className="sm:hidden border-t border-gray-100 dark:border-zinc-800 px-4 py-2 flex gap-4">
          <Link href={`/portal/${slug}`} className="text-gray-600 text-sm">Inicio</Link>
          <Link href={`/portal/${slug}/os`} className="text-gray-600 text-sm">Minhas OS</Link>
          <Link href={`/portal/${slug}/tickets`} className="text-blue-600 dark:text-blue-400 font-medium text-sm">Tickets</Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Meus Tickets</h1>
          <button
            onClick={() => setShowNew(!showNew)}
            className="py-2.5 px-5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors text-sm"
          >
            Novo Ticket
          </button>
        </div>

        {/* New ticket form */}
        {showNew && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 mb-6">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Novo Ticket</h2>
            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assunto *</label>
                <input
                  type="text"
                  value={newSubject}
                  onChange={e => setNewSubject(e.target.value)}
                  placeholder="Descreva brevemente o problema"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descricao</label>
                <textarea
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="Detalhes sobre o problema..."
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600 resize-none"
                />
              </div>
              {osList.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Vincular a uma OS (opcional)
                  </label>
                  <select
                    value={newOsId}
                    onChange={e => setNewOsId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800"
                  >
                    <option value="">Nenhuma OS</option>
                    {osList.map(os => (
                      <option key={os.id} value={os.id}>
                        OS #{os.os_number} - {os.equipment_type}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowNew(false)}
                  className="py-2.5 px-5 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="py-2.5 px-5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-xl transition-colors text-sm"
                >
                  {creating ? 'Criando...' : 'Criar Ticket'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tickets list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-12 text-center">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">Nenhum ticket encontrado</p>
            <button
              onClick={() => setShowNew(true)}
              className="mt-4 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium text-sm"
            >
              Criar primeiro ticket
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map(ticket => (
              <Link
                key={ticket.id}
                href={`/portal/${slug}/tickets/${ticket.id}`}
                className="block bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-5 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm text-gray-400 dark:text-gray-500">#{ticket.ticket_number}</span>
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: `${statusColors[ticket.status || 'ABERTO'] || '#6B7280'}20`,
                          color: statusColors[ticket.status || 'ABERTO'] || '#6B7280',
                        }}
                      >
                        {(ticket.status || 'ABERTO').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{ticket.subject}</h3>
                    {ticket.service_order && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        OS #{ticket.service_order.os_number} - {ticket.service_order.equipment_type}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {new Date(ticket.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 mt-12">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
