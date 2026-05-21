'use client'

// OsTicketsPanel — substitui OsChatPanel.
// Mostra todos os tickets vinculados a uma OS como cards expandíveis.
// Cada card colapsado: subject + status + Nº + última msg + count.
// Click expande: bubbles do ticket inteiro + input pra admin responder.
// Reusa endpoint /api/tickets/[id]/messages (POST ja dispara WhatsApp).

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MessageSquare, Send, Loader2, RefreshCw, ChevronDown, ChevronRight, User, Bot } from 'lucide-react'

interface TicketSummary {
  id: string
  ticket_number: number
  subject: string
  status: string | null
  source: string | null
  created_at: string
  updated_at: string
  last_message: {
    message: string
    sender_type: string | null
    sender_name: string | null
    created_at: string
    is_internal: boolean | null
  } | null
  message_count: number
}

interface TicketMessage {
  id: string
  message: string
  sender_type: string | null
  sender_name: string | null
  is_internal: boolean | null
  created_at: string
}

interface Props {
  osId: string
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function sourceLabel(source: string | null) {
  switch (source) {
    case 'NEGOCIACAO_OS': return 'Negociação'
    case 'COMENTARIO_OS': return 'Comentário'
    case 'CHAT_OS': return 'Chat'
    case 'BOT': return 'Bot'
    default: return source || 'Ticket'
  }
}

function sourceColor(source: string | null) {
  switch (source) {
    case 'NEGOCIACAO_OS': return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
    case 'COMENTARIO_OS': return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
    case 'CHAT_OS': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
    case 'BOT': return 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200'
    default: return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
  }
}

function statusColor(status: string | null) {
  switch (status) {
    case 'ABERTO': return 'bg-emerald-100 text-emerald-800'
    case 'EM_ANDAMENTO': return 'bg-yellow-100 text-yellow-800'
    case 'FECHADO': return 'bg-gray-200 text-gray-600'
    default: return 'bg-gray-100 text-gray-700'
  }
}

export default function OsTicketsPanel({ osId }: Props) {
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [messagesById, setMessagesById] = useState<Record<string, TicketMessage[]>>({})
  const [loadingMsgs, setLoadingMsgs] = useState<string | null>(null)
  const [replyText, setReplyText] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<string | null>(null)
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({})

  async function loadTickets(silent = false) {
    if (!silent) setLoading(true)
    try {
      const r = await fetch(`/api/os/${osId}/tickets`, { cache: 'no-store' })
      if (!r.ok) {
        if (!silent) toast.error('Falha ao carregar tickets')
        return
      }
      const j = await r.json()
      setTickets(j.data?.tickets || [])
    } catch {
      if (!silent) toast.error('Erro de rede')
    } finally {
      setLoading(false)
    }
  }

  async function loadMessages(ticketId: string, silent = false) {
    if (!silent) setLoadingMsgs(ticketId)
    try {
      const r = await fetch(`/api/tickets/${ticketId}/messages`, { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json()
      // /api/tickets/[id]/messages retorna {data: [...messages]}
      const arr: TicketMessage[] = Array.isArray(j.data) ? j.data : (j.data?.messages || [])
      setMessagesById(prev => ({ ...prev, [ticketId]: arr }))
      // auto-scroll quando msgs carregam
      setTimeout(() => {
        const ref = scrollRefs.current[ticketId]
        if (ref) ref.scrollTop = ref.scrollHeight
      }, 50)
    } finally {
      setLoadingMsgs(null)
    }
  }

  useEffect(() => {
    loadTickets()
    const id = setInterval(() => {
      loadTickets(true)
      if (expandedId) loadMessages(expandedId, true)
    }, 20000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osId, expandedId])

  function toggleExpand(ticketId: string) {
    if (expandedId === ticketId) {
      setExpandedId(null)
    } else {
      setExpandedId(ticketId)
      if (!messagesById[ticketId]) loadMessages(ticketId)
    }
  }

  async function sendReply(ticketId: string) {
    const text = (replyText[ticketId] || '').trim()
    if (!text) return
    if (text.length > 5000) { toast.error('Mensagem muito longa (max 5000)'); return }
    setSending(ticketId)
    try {
      const r = await fetch(`/api/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, is_internal: false }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        toast.error(e.error || 'Falha ao enviar')
        return
      }
      setReplyText(prev => ({ ...prev, [ticketId]: '' }))
      await loadMessages(ticketId, true)
      await loadTickets(true)
      toast.success('Enviado — cliente notificado via WhatsApp')
    } catch {
      toast.error('Erro de rede')
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="rounded-xl border-2 border-blue-200 dark:border-blue-900 bg-white dark:bg-gray-900 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
            <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">
              Mensagens do cliente
            </h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              Tickets vinculados a esta OS. Respostas vão pelo WhatsApp + portal.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => loadTickets()}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
          title="Atualizar"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="text-center py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...</div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-6 text-sm text-gray-400 italic">
          Sem mensagens do cliente. Quando o cliente comentar, recusar orçamento ou abrir ticket sobre esta OS, aparecerá aqui.
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => {
            const expanded = expandedId === t.id
            const msgs = messagesById[t.id] || []
            const loadingThis = loadingMsgs === t.id
            return (
              <div key={t.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpand(t.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  aria-expanded={expanded ? 'true' : 'false'}
                >
                  {expanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-gray-500 shrink-0" />
                    : <ChevronRight className="h-3.5 w-3.5 text-gray-500 shrink-0" />}
                  <span className={`text-[10px] font-semibold uppercase rounded px-1.5 py-0.5 ${sourceColor(t.source)}`}>
                    {sourceLabel(t.source)}
                  </span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {t.subject}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">#{t.ticket_number}</span>
                  <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ml-auto shrink-0 ${statusColor(t.status)}`}>
                    {t.status || 'ABERTO'}
                  </span>
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {t.message_count} msg
                  </span>
                </button>
                {!expanded && t.last_message && (
                  <div className="px-3 pb-2 text-xs text-gray-500 dark:text-gray-400 truncate pl-9">
                    <span className="font-medium">{t.last_message.sender_type === 'CLIENTE' ? 'Cliente' : t.last_message.sender_name || 'Atendente'}:</span>{' '}
                    {t.last_message.message.slice(0, 120)}
                    <span className="ml-2 text-[10px]">{formatTime(t.last_message.created_at)}</span>
                  </div>
                )}
                {expanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-900">
                    <div
                      ref={el => { scrollRefs.current[t.id] = el }}
                      className="max-h-72 overflow-y-auto mb-3 space-y-2 pr-1"
                    >
                      {loadingThis ? (
                        <div className="text-center py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...</div>
                      ) : msgs.length === 0 ? (
                        <div className="text-center py-6 text-sm text-gray-400 italic">Sem mensagens neste ticket.</div>
                      ) : (
                        msgs.map(m => {
                          const isCliente = m.sender_type === 'CLIENTE'
                          const isBot = m.sender_type === 'BOT'
                          const mineSide = !isCliente
                          return (
                            <div key={m.id} className={`flex ${mineSide ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                                mineSide
                                  ? (m.is_internal ? 'bg-yellow-100 text-yellow-900 border border-yellow-300' : 'bg-blue-600 text-white')
                                  : isBot
                                    ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200'
                                    : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                              }`}>
                                {(!mineSide || m.is_internal) && (
                                  <div className="flex items-center gap-1 text-[10px] font-medium opacity-70 mb-0.5">
                                    {isBot ? <Bot className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
                                    {m.sender_name || (isCliente ? 'Cliente' : isBot ? 'Bot' : 'Atendente')}
                                    {m.is_internal && ' · interno'}
                                  </div>
                                )}
                                <div className="whitespace-pre-wrap break-words">{m.message}</div>
                                <div className={`text-[9px] mt-1 ${mineSide && !m.is_internal ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                                  {formatTime(m.created_at)}
                                </div>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                    <div className="flex gap-2 items-end">
                      <textarea
                        value={replyText[t.id] || ''}
                        onChange={e => setReplyText(prev => ({ ...prev, [t.id]: e.target.value }))}
                        placeholder="Responder ao cliente..."
                        rows={2}
                        maxLength={5000}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault()
                            if (sending !== t.id) sendReply(t.id)
                          }
                        }}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none"
                      />
                      <button
                        type="button"
                        onClick={() => sendReply(t.id)}
                        disabled={sending === t.id || !(replyText[t.id] || '').trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg flex items-center gap-1.5 text-sm font-medium"
                        title="Enviar (Ctrl+Enter)"
                      >
                        {sending === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Enviar
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5">Ctrl+Enter envia · cliente recebe WhatsApp + vê no portal</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
