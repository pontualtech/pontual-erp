'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

interface TicketDetail {
  id: string
  ticket_number: number
  subject: string
  description?: string
  status?: string
  priority?: string
  category?: string
  service_order?: { os_number: number; equipment_type: string } | null
  messages: Array<{
    id: string
    message: string
    sender_type?: string
    sender_name?: string
    created_at: string
  }>
  created_at: string
  closed_at?: string
}

export default function PortalTicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const ticketId = params.id as string

  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [company, setCompany] = useState<{ name: string } | null>(null)
  const [customer, setCustomer] = useState<{ name: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  function loadTicket() {
    // Auth token is sent automatically via httpOnly cookie
    fetch(`/api/portal/tickets/${ticketId}`)
      .then(r => {
        if (r.status === 401) {
          router.push(`/portal/${slug}/login`)
          return null
        }
        return r.json()
      })
      .then(res => {
        if (res?.data) setTicket(res.data)
      })
      .catch(() => toast.error('Erro ao carregar ticket'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const savedCompany = localStorage.getItem('portal_company')
    const savedCustomer = localStorage.getItem('portal_customer')
    if (savedCompany) setCompany(JSON.parse(savedCompany))
    if (savedCustomer) setCustomer(JSON.parse(savedCustomer))
    loadTicket()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [ticket?.messages])

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return

    setSending(true)
    try {
      const res = await fetch(`/api/portal/tickets/${ticketId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao enviar')
        return
      }

      setMessage('')
      loadTicket()
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setSending(false)
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center dark:bg-zinc-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-500" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="min-h-screen flex items-center justify-center dark:bg-zinc-950">
        <div className="text-center">
          <p className="text-gray-500 dark:text-gray-400 mb-4">Ticket nao encontrado</p>
          <Link href={`/portal/${slug}/tickets`} className="text-blue-600 dark:text-blue-400 hover:text-blue-700">
            Voltar para lista
          </Link>
        </div>
      </div>
    )
  }

  const isClosed = ticket.status === 'FECHADO'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex flex-col">
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
            <Link href={`/portal/${slug}`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">Inicio</Link>
            <Link href={`/portal/${slug}/os`} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm">Minhas OS</Link>
            <Link href={`/portal/${slug}/tickets`} className="text-blue-600 dark:text-blue-400 font-medium text-sm">Tickets</Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:block">{customer?.name}</span>
            <button onClick={handleLogout} className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 font-medium">Sair</button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-6 flex-1 w-full">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-6">
          <Link href={`/portal/${slug}/tickets`} className="hover:text-gray-700 dark:hover:text-gray-300">Tickets</Link>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-900 dark:text-gray-100 font-medium">#{ticket.ticket_number}</span>
        </div>

        {/* Ticket info */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{ticket.subject}</h1>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-sm text-gray-400 dark:text-gray-500">#{ticket.ticket_number}</span>
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: `${statusColors[ticket.status || 'ABERTO'] || '#6B7280'}20`,
                    color: statusColors[ticket.status || 'ABERTO'] || '#6B7280',
                  }}
                >
                  {(ticket.status || 'ABERTO').replace(/_/g, ' ')}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {new Date(ticket.created_at).toLocaleDateString('pt-BR', {
                    day: '2-digit', month: 'long', year: 'numeric'
                  })}
                </span>
              </div>
            </div>
          </div>

          {ticket.description && (
            <p className="text-gray-700 dark:text-gray-300 mt-4 text-sm">{ticket.description}</p>
          )}

          {ticket.service_order && (
            <div className="mt-4 inline-flex items-center gap-2 bg-gray-100 dark:bg-zinc-800 rounded-lg px-3 py-1.5">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                OS #{ticket.service_order.os_number} - {ticket.service_order.equipment_type}
              </span>
            </div>
          )}
        </div>

        {/* Messages (chat) */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 mb-6">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Mensagens</h2>
          </div>

          <div className="p-5 space-y-4 max-h-[500px] overflow-y-auto">
            {ticket.messages.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-gray-500 py-8">Nenhuma mensagem ainda</p>
            ) : (
              ticket.messages.map(msg => {
                const isClient = msg.sender_type === 'CLIENTE'
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        isClient
                          ? 'bg-blue-600 dark:bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      {!isClient && (
                        <p className={`text-xs font-medium mb-1 ${
                          isClient ? 'text-blue-200' : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {msg.sender_name || 'Atendente'}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      <p className={`text-xs mt-1 ${
                        isClient ? 'text-blue-200' : 'text-gray-400 dark:text-gray-500'
                      }`}>
                        {new Date(msg.created_at).toLocaleTimeString('pt-BR', {
                          hour: '2-digit', minute: '2-digit',
                          day: '2-digit', month: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply */}
          {!isClosed ? (
            <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-100 dark:border-zinc-800">
              <div className="flex gap-3">
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Digite sua mensagem..."
                  rows={2}
                  className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 dark:bg-zinc-800 resize-none text-sm"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage(e)
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={sending || !message.trim()}
                  className="self-end py-2.5 px-5 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-zinc-700 text-white font-medium rounded-xl transition-colors text-sm"
                >
                  {sending ? '...' : 'Enviar'}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-4 border-t border-gray-100 dark:border-zinc-800 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">Este ticket esta fechado</p>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
