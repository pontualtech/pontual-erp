'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'
import { Send, Plus, Hash, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'

interface ChatMsg {
  id: string
  sender_id: string
  sender_name: string
  message: string
  channel: string
  created_at: string
}

interface ChannelInfo {
  channel: string
  last_message: string
  last_at: string
  msg_count: number
}

const DEFAULT_CHANNELS = ['geral', 'tecnicos', 'financeiro', 'comercial']

export default function ChatPage() {
  const { user } = useAuth()
  const [channels, setChannels] = useState<ChannelInfo[]>([])
  const [activeChannel, setActiveChannel] = useState('geral')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Load channels
  const loadChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/channels')
      const json = await res.json()
      if (json.data) {
        const existing = json.data as ChannelInfo[]
        // Merge default channels that don't exist yet
        const existingNames = new Set(existing.map((c: ChannelInfo) => c.channel))
        const merged = [...existing]
        for (const ch of DEFAULT_CHANNELS) {
          if (!existingNames.has(ch)) {
            merged.push({ channel: ch, last_message: '', last_at: '', msg_count: 0 })
          }
        }
        setChannels(merged)
      }
    } catch { toast.error('Erro ao carregar canais') }
  }, [])

  // Load messages for active channel
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?channel=${encodeURIComponent(activeChannel)}`)
      const json = await res.json()
      if (json.data) {
        setMessages(json.data)
      }
    } catch { toast.error('Erro ao carregar mensagens') }
  }, [activeChannel])

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  useEffect(() => {
    loadMessages()
    // Poll every 5 seconds
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(loadMessages, 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [loadMessages])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const sendMessage = async () => {
    if (!input.trim() || sending) return
    setSending(true)
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input.trim(), channel: activeChannel }),
      })
      setInput('')
      await loadMessages()
      loadChannels()
    } catch { toast.error('Erro ao enviar mensagem') }
    setSending(false)
  }

  const createChannel = () => {
    const name = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (!name) return
    const exists = channels.some(c => c.channel === name)
    if (!exists) {
      setChannels(prev => [...prev, { channel: name, last_message: '', last_at: '', msg_count: 0 }])
    }
    setActiveChannel(name)
    setShowNewChannel(false)
    setNewChannelName('')
  }

  const formatTime = (dateStr: string) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  const formatChannelLabel = (ch: string) => {
    return ch.charAt(0).toUpperCase() + ch.slice(1).replace(/-/g, ' ')
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-lg border bg-white shadow-sm">
      {/* Left panel - channels */}
      <div className="w-64 flex-shrink-0 border-r flex flex-col bg-gray-50">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Chat
          </h2>
          <button
            onClick={() => setShowNewChannel(true)}
            className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
            title="Novo Canal"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {showNewChannel && (
          <div className="border-b px-3 py-2">
            <input
              type="text"
              value={newChannelName}
              onChange={e => setNewChannelName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createChannel()}
              placeholder="Nome do canal..."
              className="w-full rounded border px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            <div className="mt-1 flex gap-1">
              <button
                onClick={createChannel}
                className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700"
              >
                Criar
              </button>
              <button
                onClick={() => { setShowNewChannel(false); setNewChannelName('') }}
                className="rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {channels.map(ch => (
            <button
              key={ch.channel}
              onClick={() => setActiveChannel(ch.channel)}
              className={cn(
                'w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-100 transition-colors',
                activeChannel === ch.channel && 'bg-blue-50 border-l-2 border-l-blue-600'
              )}
            >
              <div className="flex items-center gap-2">
                <Hash className="h-3.5 w-3.5 text-gray-400" />
                <span className={cn(
                  'text-sm font-medium',
                  activeChannel === ch.channel ? 'text-blue-700' : 'text-gray-700'
                )}>
                  {formatChannelLabel(ch.channel)}
                </span>
              </div>
              {ch.last_message && (
                <p className="mt-0.5 truncate text-xs text-gray-500 pl-5">
                  {ch.last_message}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right panel - messages */}
      <div className="flex flex-1 flex-col">
        {/* Channel header */}
        <div className="border-b px-5 py-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Hash className="h-4 w-4 text-gray-400" />
            {formatChannelLabel(activeChannel)}
          </h3>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-gray-400">Nenhuma mensagem ainda. Seja o primeiro!</p>
            </div>
          ) : (
            messages.map(msg => {
              const isOwn = !!(user?.id && msg.sender_id === user.id)
              return (
                <div
                  key={msg.id}
                  className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[70%] rounded-lg px-3 py-2 shadow-sm',
                      isOwn
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                    )}
                  >
                    {!isOwn && (
                      <p className="text-xs font-semibold text-blue-600 mb-0.5">
                        {msg.sender_name}
                      </p>
                    )}
                    {isOwn && (
                      <p className="text-xs font-semibold text-blue-200 mb-0.5 text-right">
                        Voce
                      </p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                    <p className={cn(
                      'mt-1 text-right text-[10px]',
                      isOwn ? 'text-blue-200' : 'text-gray-400'
                    )}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder={`Mensagem em #${activeChannel}...`}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              title="Enviar mensagem"
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className={cn(
                'rounded-lg p-2 transition-colors',
                input.trim() && !sending
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
