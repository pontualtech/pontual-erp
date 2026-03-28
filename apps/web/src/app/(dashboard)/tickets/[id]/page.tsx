'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  ArrowLeft, Send, Loader2, User, Clock, Tag, LinkIcon,
  MessageSquare, Lock, ChevronRight,
} from 'lucide-react'
import { useAuth } from '@/lib/use-auth'

interface TicketMessage {
  id: string
  message: string
  sender_type: string
  sender_id: string | null
  sender_name: string | null
  is_internal: boolean
  created_at: string
}

interface TicketDetail {
  id: string
  ticket_number: number
  subject: string
  description: string | null
  status: string
  priority: string
  category: string | null
  source: string
  assigned_to: string | null
  assigned_user_name: string | null
  created_by: string | null
  created_by_name: string | null
  created_by_type: string | null
  customer_id: string | null
  service_order_id: string | null
  customers: { id: string; legal_name: string; phone: string | null } | null
  service_orders: { id: string; os_number: number; equipment_type: string | null } | null
  ticket_messages: TicketMessage[]
  created_at: string
  updated_at: string
}

interface UserOption { id: string; name: string }

const statusLabel: Record<string, string> = {
  ABERTO: 'Aberto',
  EM_ANDAMENTO: 'Em Andamento',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
}

const statusColor: Record<string, string> = {
  ABERTO: 'bg-blue-100 text-blue-700 border-blue-200',
  EM_ANDAMENTO: 'bg-amber-100 text-amber-700 border-amber-200',
  RESOLVIDO: 'bg-green-100 text-green-700 border-green-200',
  FECHADO: 'bg-gray-100 text-gray-500 border-gray-200',
}

const priorityLabel: Record<string, string> = {
  BAIXA: 'Baixa',
  NORMAL: 'Normal',
  ALTA: 'Alta',
  URGENTE: 'Urgente',
}

const priorityColor: Record<string, string> = {
  BAIXA: 'bg-gray-100 text-gray-600',
  NORMAL: 'bg-blue-100 text-blue-700',
  ALTA: 'bg-orange-100 text-orange-700',
  URGENTE: 'bg-red-100 text-red-700',
}

const statusFlow: string[] = ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO']

export default function TicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user: authUser } = useAuth()
  const id = params.id as string

  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserOption[]>([])

  // Message form
  const [newMessage, setNewMessage] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Status/assignment updates
  const [updating, setUpdating] = useState(false)

  function loadTicket() {
    fetch(`/api/tickets/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.data) setTicket(d.data)
        else toast.error('Ticket nao encontrado')
      })
      .catch(() => toast.error('Erro ao carregar ticket'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadTicket() }, [id])
  useEffect(() => {
    fetch('/api/users?limit=100')
      .then(r => r.json())
      .then(d => setUsers(d.data || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [ticket?.ticket_messages])

  async function updateTicket(data: Record<string, string | null>) {
    setUpdating(true)
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Erro ao atualizar')
      toast.success('Ticket atualizado')
      loadTicket()
    } catch {
      toast.error('Erro ao atualizar ticket')
    } finally {
      setUpdating(false)
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!newMessage.trim()) return

    setSending(true)
    try {
      const res = await fetch(`/api/tickets/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage, is_internal: isInternal }),
      })
      if (!res.ok) throw new Error('Erro ao enviar mensagem')
      setNewMessage('')
      setIsInternal(false)
      loadTicket()
    } catch {
      toast.error('Erro ao enviar mensagem')
    } finally {
      setSending(false)
    }
  }

  function getNextStatus(current: string): string | null {
    const idx = statusFlow.indexOf(current)
    if (idx < 0 || idx >= statusFlow.length - 1) return null
    return statusFlow[idx + 1]
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!ticket) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Ticket nao encontrado</p>
        <Link href="/tickets" className="text-blue-600 hover:underline text-sm mt-2 inline-block">Voltar</Link>
      </div>
    )
  }

  const nextStatus = getNextStatus(ticket.status)

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-6rem)]">
      {/* Main content — Chat */}
      <div className="flex-1 flex flex-col min-w-0 rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center gap-3 border-b dark:border-gray-700 px-4 py-3">
          <Link href="/tickets" className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-700">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-500 dark:text-gray-400">
                #{String(ticket.ticket_number).padStart(4, '0')}
              </span>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                {ticket.subject}
              </h1>
            </div>
          </div>
          <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium shrink-0', statusColor[ticket.status])}>
            {statusLabel[ticket.status] ?? ticket.status}
          </span>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium shrink-0', priorityColor[ticket.priority])}>
            {priorityLabel[ticket.priority] ?? ticket.priority}
          </span>
        </div>

        {/* Description (if any) */}
        {ticket.description && (
          <div className="px-4 py-3 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{ticket.description}</p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {ticket.ticket_messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <MessageSquare className="h-10 w-10 mb-2" />
              <p className="text-sm">Nenhuma mensagem ainda</p>
              <p className="text-xs">Envie a primeira mensagem abaixo</p>
            </div>
          ) : (
            ticket.ticket_messages.map(msg => {
              const isMine = msg.sender_id === authUser?.id
              const isInternalMsg = msg.is_internal

              return (
                <div
                  key={msg.id}
                  className={cn('flex', isMine ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm',
                      isInternalMsg
                        ? 'bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
                        : isMine
                          ? 'bg-blue-600 text-white'
                          : msg.sender_type === 'CLIENTE'
                            ? 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200'
                            : 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                    )}
                  >
                    {/* Internal note label */}
                    {isInternalMsg && (
                      <div className="flex items-center gap-1 mb-1">
                        <Lock className="h-3 w-3 text-yellow-600 dark:text-yellow-400" />
                        <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400">Nota interna</span>
                      </div>
                    )}
                    {/* Sender name */}
                    <p className={cn(
                      'text-xs font-medium mb-0.5',
                      isInternalMsg
                        ? 'text-yellow-800 dark:text-yellow-300'
                        : isMine
                          ? 'text-blue-100'
                          : msg.sender_type === 'CLIENTE'
                            ? 'text-green-700 dark:text-green-300'
                            : 'text-gray-500 dark:text-gray-400'
                    )}>
                      {msg.sender_name || 'Sistema'}
                    </p>
                    {/* Message */}
                    <p className={cn(
                      'text-sm whitespace-pre-wrap',
                      isInternalMsg ? 'text-yellow-900 dark:text-yellow-100' : ''
                    )}>
                      {msg.message}
                    </p>
                    {/* Time */}
                    <p className={cn(
                      'text-xs mt-1',
                      isInternalMsg
                        ? 'text-yellow-600 dark:text-yellow-500'
                        : isMine
                          ? 'text-blue-200'
                          : 'text-gray-400 dark:text-gray-500'
                    )}>
                      {new Date(msg.created_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply area */}
        <div className="border-t dark:border-gray-700 px-4 py-3">
          <form onSubmit={sendMessage} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={e => setIsInternal(e.target.checked)}
                  className="rounded text-yellow-500 focus:ring-yellow-500"
                />
                <Lock className="h-3 w-3 text-yellow-600" />
                <span className="text-yellow-700 dark:text-yellow-400 font-medium">Nota interna</span>
              </label>
              {isInternal && (
                <span className="text-xs text-yellow-600 dark:text-yellow-500">
                  (visivel apenas para a equipe)
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <textarea
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(e)
                  }
                }}
                placeholder={isInternal ? 'Escrever nota interna...' : 'Escrever mensagem...'}
                rows={2}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm outline-none resize-none focus:ring-1',
                  isInternal
                    ? 'bg-yellow-50 border-yellow-200 focus:border-yellow-400 focus:ring-yellow-400 dark:bg-yellow-900/20 dark:border-yellow-800'
                    : 'bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 focus:border-blue-500 focus:ring-blue-500'
                )}
              />
              <button
                type="submit"
                disabled={sending || !newMessage.trim()}
                className={cn(
                  'self-end rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 flex items-center gap-1.5',
                  isInternal ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-blue-600 hover:bg-blue-700'
                )}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Sidebar — Info */}
      <div className="w-full lg:w-72 shrink-0 space-y-3">
        {/* Status actions */}
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Acoes</h3>

          {/* Status flow buttons */}
          <div className="flex flex-col gap-1.5">
            {statusFlow.map(st => (
              <button
                key={st}
                type="button"
                disabled={updating || ticket.status === st}
                onClick={() => updateTicket({ status: st })}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors border',
                  ticket.status === st
                    ? statusColor[st] + ' cursor-default'
                    : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                )}
              >
                {ticket.status === st && <ChevronRight className="h-3 w-3" />}
                {statusLabel[st]}
              </button>
            ))}
          </div>

          {nextStatus && (
            <button
              type="button"
              disabled={updating}
              onClick={() => updateTicket({ status: nextStatus })}
              className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Mover para {statusLabel[nextStatus]}
            </button>
          )}
        </div>

        {/* Details */}
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Detalhes</h3>

          {/* Assigned to */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">Responsavel</label>
            <select
              value={ticket.assigned_to || ''}
              onChange={e => updateTicket({ assigned_to: e.target.value || null })}
              disabled={updating}
              className="mt-0.5 w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
            >
              <option value="">Nao atribuido</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">Categoria</label>
            <p className="text-sm text-gray-900 dark:text-gray-200 mt-0.5">
              {ticket.category || '—'}
            </p>
          </div>

          {/* Priority */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">Prioridade</label>
            <p className="mt-0.5">
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', priorityColor[ticket.priority])}>
                {priorityLabel[ticket.priority] ?? ticket.priority}
              </span>
            </p>
          </div>

          {/* Source */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">Origem</label>
            <p className="text-sm text-gray-900 dark:text-gray-200 mt-0.5">
              {ticket.source === 'INTERNO' ? 'Interno' : 'Cliente'}
            </p>
          </div>

          {/* Created by */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">Criado por</label>
            <div className="flex items-center gap-1.5 mt-0.5">
              <User className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-sm text-gray-900 dark:text-gray-200">
                {ticket.created_by_name || '—'}
              </span>
            </div>
          </div>

          {/* Created at */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">Data de criacao</label>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-sm text-gray-900 dark:text-gray-200">
                {new Date(ticket.created_at).toLocaleString('pt-BR')}
              </span>
            </div>
          </div>
        </div>

        {/* Links */}
        {(ticket.customers || ticket.service_orders) && (
          <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Vinculos</h3>

            {ticket.customers && (
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Cliente</label>
                <Link
                  href={`/clientes/${ticket.customers.id}`}
                  className="flex items-center gap-1.5 mt-0.5 text-sm text-blue-600 hover:underline"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  {ticket.customers.legal_name}
                </Link>
              </div>
            )}

            {ticket.service_orders && (
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">Ordem de Servico</label>
                <Link
                  href={`/os/${ticket.service_orders.id}`}
                  className="flex items-center gap-1.5 mt-0.5 text-sm text-blue-600 hover:underline"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  OS-{String(ticket.service_orders.os_number).padStart(4, '0')}
                  {ticket.service_orders.equipment_type ? ` - ${ticket.service_orders.equipment_type}` : ''}
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
