'use client'

// Componente reusavel de chat inline na OS — funciona tanto no admin (variant=admin)
// quanto no portal cliente (variant=portal). Diferenca: endpoint base + sender_type
// renderizado. Lista + input livre + envio + auto-refresh a cada 15s.
//
// Backend:
// - admin: /api/os/[id]/chat (GET+POST)
// - portal: /api/portal/os/[id]/chat (GET+POST)

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MessageCircle, Send, Loader2, RefreshCw, User } from 'lucide-react'

interface ChatMessage {
  id: string
  message: string
  sender_type: string | null  // FUNCIONARIO | CLIENTE | BOT
  sender_name: string | null
  is_internal: boolean | null
  created_at: string
}

interface Props {
  osId: string
  variant: 'admin' | 'portal'
  currentUserName?: string
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

export default function OsChatPanel({ osId, variant, currentUserName }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const endpoint = variant === 'admin'
    ? `/api/os/${osId}/chat`
    : `/api/portal/os/${osId}/chat`

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const r = await fetch(endpoint, { cache: 'no-store' })
      if (!r.ok) {
        if (!silent) toast.error('Falha ao carregar mensagens')
        return
      }
      const j = await r.json()
      const arr: ChatMessage[] = j.data?.messages || []
      setMessages(arr)
    } catch {
      if (!silent) toast.error('Erro de rede')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const id = setInterval(() => load(true), 15000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osId])

  // Auto-scroll pro fim quando msgs mudam
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length])

  async function send() {
    const trimmed = text.trim()
    if (!trimmed) return
    if (trimmed.length > 5000) { toast.error('Mensagem muito longa (max 5000)'); return }
    setSending(true)
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        toast.error(e.error || 'Falha ao enviar')
        return
      }
      setText('')
      await load(true)
      if (variant === 'admin') toast.success('Enviado — cliente notificado via WhatsApp')
    } catch {
      toast.error('Erro de rede')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-xl border-2 border-blue-200 dark:border-blue-900 bg-white dark:bg-gray-900 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
            <MessageCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">
              {variant === 'admin' ? 'Conversa com cliente' : 'Mensagens'}
            </h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {variant === 'admin'
                ? 'Resposta enviada via WhatsApp + portal'
                : 'Converse com nossa equipe sobre esta OS'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
          title="Atualizar"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={scrollRef} className="max-h-64 overflow-y-auto mb-3 space-y-2 pr-1">
        {loading ? (
          <div className="text-center py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...</div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400 italic">
            Nenhuma mensagem ainda. {variant === 'admin' ? 'Envie a primeira pra cliente.' : 'Tire dúvidas sobre sua OS.'}
          </div>
        ) : (
          messages.map(m => {
            const isCliente = m.sender_type === 'CLIENTE'
            const isBot = m.sender_type === 'BOT'
            const mineSide = variant === 'admin' ? !isCliente : isCliente
            return (
              <div key={m.id} className={`flex ${mineSide ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  mineSide
                    ? 'bg-blue-600 text-white'
                    : isBot
                      ? 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200'
                      : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                }`}>
                  {!mineSide && (
                    <div className="flex items-center gap-1 text-[10px] font-medium opacity-70 mb-0.5">
                      <User className="h-2.5 w-2.5" />
                      {m.sender_name || (isCliente ? 'Cliente' : isBot ? 'Bot' : 'Atendente')}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{m.message}</div>
                  <div className={`text-[9px] mt-1 ${mineSide ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
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
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={variant === 'admin' ? 'Escreva uma resposta ao cliente...' : 'Escreva uma mensagem...'}
          rows={2}
          maxLength={5000}
          onKeyDown={e => {
            // Ctrl+Enter envia (Enter sozinho permite quebra de linha)
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (!sending) send()
            }
          }}
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg flex items-center gap-1.5 text-sm font-medium"
          title="Enviar (Ctrl+Enter)"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar
        </button>
      </div>
      <p className="text-[10px] text-gray-400 mt-1.5">Ctrl+Enter envia</p>
    </div>
  )
}
