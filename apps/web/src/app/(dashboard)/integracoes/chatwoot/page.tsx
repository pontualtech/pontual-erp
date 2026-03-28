'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, MessageSquare, Send, Search, RefreshCw,
  Phone, User, Link2, FileText, Loader2, ChevronLeft,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

interface Conversation {
  id: number
  contact_name: string
  contact_phone: string
  last_message: string
  status: string
  inbox_id: number
  inbox_name: string
  created_at: string
  updated_at: string
}

interface Message {
  id: number
  content: string
  message_type: 'incoming' | 'outgoing' | 'activity'
  sender_name: string
  sender_type: string
  created_at: number
  content_type: string
  attachments: any[]
}

const statusColor: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  resolved: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  snoozed: 'bg-gray-100 text-gray-500',
}

const statusLabel: Record<string, string> = {
  open: 'Aberta',
  resolved: 'Resolvida',
  pending: 'Pendente',
  snoozed: 'Adiada',
}

export default function ChatwootPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('open')
  const [inboxFilter, setInboxFilter] = useState('')
  const [search, setSearch] = useState('')

  // Conversation detail
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Send OS modal
  const [showSendOS, setShowSendOS] = useState(false)
  const [osSearch, setOsSearch] = useState('')
  const [osList, setOsList] = useState<any[]>([])
  const [loadingOS, setLoadingOS] = useState(false)

  function loadConversations() {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (inboxFilter) params.set('inbox_id', inboxFilter)
    fetch(`/api/integracoes/chatwoot/conversas?${params}`)
      .then(r => r.json())
      .then(d => {
        const data = d.data ?? []
        setConversations(data)
      })
      .catch(() => toast.error('Erro ao carregar conversas do Chatwoot'))
      .finally(() => setLoading(false))
  }

  function loadMessages(convId: number) {
    setLoadingMessages(true)
    fetch(`/api/integracoes/chatwoot/conversas/${convId}`)
      .then(r => r.json())
      .then(d => {
        setMessages(d.data ?? [])
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
      })
      .catch(() => toast.error('Erro ao carregar mensagens'))
      .finally(() => setLoadingMessages(false))
  }

  function handleSelectConversation(conv: Conversation) {
    setSelectedConv(conv)
    loadMessages(conv.id)
  }

  async function handleSendReply() {
    if (!replyText.trim() || !selectedConv) return
    setSending(true)
    try {
      const res = await fetch(`/api/integracoes/chatwoot/conversas/${selectedConv.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText }),
      })
      if (!res.ok) throw new Error('Falha ao enviar')
      setReplyText('')
      // Reload messages
      loadMessages(selectedConv.id)
      toast.success('Mensagem enviada')
    } catch {
      toast.error('Erro ao enviar mensagem')
    } finally {
      setSending(false)
    }
  }

  async function handleSendOS(os: any) {
    if (!selectedConv) return
    const osNum = String(os.os_number).padStart(4, '0')
    const msg = [
      `*OS-${osNum}*`,
      `Equipamento: ${os.equipment_type || ''} ${os.equipment_brand || ''} ${os.equipment_model || ''}`.trim(),
      os.reported_issue ? `Defeito: ${os.reported_issue}` : '',
      os.status_name ? `Status: ${os.status_name}` : '',
      os.total_cost ? `Valor: R$ ${Number(os.total_cost).toFixed(2).replace('.', ',')}` : '',
    ].filter(Boolean).join('\n')

    setSending(true)
    try {
      const res = await fetch(`/api/integracoes/chatwoot/conversas/${selectedConv.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      if (!res.ok) throw new Error('Falha ao enviar')
      setShowSendOS(false)
      loadMessages(selectedConv.id)
      toast.success('OS enviada para o cliente')
    } catch {
      toast.error('Erro ao enviar OS')
    } finally {
      setSending(false)
    }
  }

  function searchOS(q: string) {
    setOsSearch(q)
    if (q.length < 2) { setOsList([]); return }
    setLoadingOS(true)
    fetch(`/api/os?search=${encodeURIComponent(q)}&limit=10`)
      .then(r => r.json())
      .then(d => setOsList(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingOS(false))
  }

  useEffect(() => { loadConversations() }, [statusFilter, inboxFilter])

  // Filter by search locally
  const filteredConversations = search
    ? conversations.filter(c =>
        c.contact_name.toLowerCase().includes(search.toLowerCase()) ||
        c.contact_phone.includes(search) ||
        c.last_message.toLowerCase().includes(search.toLowerCase())
      )
    : conversations

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/config" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Chatwoot / WhatsApp
            </h1>
          </div>
          <p className="text-sm text-gray-500 ml-7">
            Conversas e mensagens via Chatwoot
          </p>
        </div>
        <button
          onClick={loadConversations}
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            placeholder="Buscar por nome, telefone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          title="Filtrar por status"
          className="rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">Todos os status</option>
          <option value="open">Abertas</option>
          <option value="resolved">Resolvidas</option>
          <option value="pending">Pendentes</option>
        </select>
        <select
          value={inboxFilter}
          onChange={e => setInboxFilter(e.target.value)}
          title="Filtrar por inbox"
          className="rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="">Todas as caixas</option>
          <option value="4">Vendas WhatsApp</option>
          <option value="3">Suporte Pontualtech</option>
          <option value="7">Pontualtech Assistencia</option>
        </select>
      </div>

      <div className="flex gap-4" style={{ minHeight: '60vh' }}>
        {/* Conversation List */}
        <div className={cn(
          'w-full md:w-1/3 overflow-y-auto rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm',
          selectedConv && 'hidden md:block'
        )}>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="py-20 text-center text-sm text-gray-400">
              Nenhuma conversa encontrada
            </div>
          ) : (
            <div className="divide-y dark:divide-gray-700">
              {filteredConversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  className={cn(
                    'w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors',
                    selectedConv?.id === conv.id && 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-gray-400 shrink-0" />
                        <span className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm">
                          {conv.contact_name}
                        </span>
                      </div>
                      {conv.contact_phone && (
                        <div className="flex items-center gap-1 mt-0.5 ml-6">
                          <Phone className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-500">{conv.contact_phone}</span>
                        </div>
                      )}
                      <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400 truncate">
                        {conv.last_message || 'Sem mensagens'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusColor[conv.status] || 'bg-gray-100 text-gray-500')}>
                        {statusLabel[conv.status] || conv.status}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {conv.inbox_name}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conversation Detail */}
        <div className={cn(
          'flex-1 flex flex-col rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm',
          !selectedConv && 'hidden md:flex'
        )}>
          {!selectedConv ? (
            <div className="flex flex-1 items-center justify-center text-gray-400">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">Selecione uma conversa</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="flex items-center justify-between border-b dark:border-gray-700 px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedConv(null)}
                    className="md:hidden text-gray-400 hover:text-gray-600"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {selectedConv.contact_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {selectedConv.contact_phone} - {selectedConv.inbox_name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowSendOS(true)}
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                    title="Enviar resumo de OS para o cliente"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Enviar OS
                  </button>
                  <button
                    onClick={() => {
                      if (selectedConv.contact_phone) {
                        window.open(`/clientes?search=${encodeURIComponent(selectedConv.contact_phone)}`, '_blank')
                      }
                    }}
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                    title="Vincular contato a um cliente do ERP"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Vincular a Cliente
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 'calc(60vh - 130px)' }}>
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-10">Nenhuma mensagem</p>
                ) : (
                  messages.map(msg => {
                    if (msg.message_type === 'activity') {
                      return (
                        <div key={msg.id} className="text-center">
                          <span className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-700 rounded-full px-3 py-1">
                            {msg.content}
                          </span>
                        </div>
                      )
                    }
                    const isOutgoing = msg.message_type === 'outgoing'
                    return (
                      <div key={msg.id} className={cn('flex', isOutgoing ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[75%] rounded-lg px-3 py-2 text-sm',
                          isOutgoing
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                        )}>
                          {!isOutgoing && msg.sender_name && (
                            <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">
                              {msg.sender_name}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          <p className={cn(
                            'text-[10px] mt-1',
                            isOutgoing ? 'text-blue-200' : 'text-gray-400'
                          )}>
                            {msg.created_at
                              ? new Date(msg.created_at * 1000).toLocaleString('pt-BR', {
                                  day: '2-digit', month: '2-digit',
                                  hour: '2-digit', minute: '2-digit',
                                })
                              : ''}
                          </p>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              <div className="border-t dark:border-gray-700 p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSendReply()
                      }
                    }}
                    placeholder="Digite sua mensagem..."
                    rows={2}
                    className="flex-1 resize-none rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={sending || !replyText.trim()}
                    className="flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Send OS Modal */}
      {showSendOS && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 shadow-xl">
            <div className="flex items-center justify-between border-b dark:border-gray-700 px-4 py-3">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Enviar OS para o cliente</h3>
              <button onClick={() => setShowSendOS(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  placeholder="Buscar OS por numero ou cliente..."
                  value={osSearch}
                  onChange={e => searchOS(e.target.value)}
                  className="w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="max-h-60 overflow-y-auto divide-y dark:divide-gray-700">
                {loadingOS ? (
                  <div className="py-6 text-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400 mx-auto" /></div>
                ) : osList.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">
                    {osSearch.length >= 2 ? 'Nenhuma OS encontrada' : 'Digite para buscar'}
                  </p>
                ) : (
                  osList.map((os: any) => (
                    <button
                      key={os.id}
                      onClick={() => handleSendOS(os)}
                      disabled={sending}
                      className="w-full px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 text-sm disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-blue-600">
                          OS-{String(os.os_number).padStart(4, '0')}
                        </span>
                        <span className="text-xs text-gray-400">{os.status_name}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {os.customer_name} - {os.equipment_type} {os.equipment_brand} {os.equipment_model}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
