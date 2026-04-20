'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send } from 'lucide-react'
import { toast } from 'sonner'

type Msg = {
  id: string
  sender_id: string
  sender_name: string
  message: string
  is_me: boolean
  created_at: string
}

export default function DriverChatPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const lastFetchRef = useRef<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const initialLoadRef = useRef(true)

  async function loadMessages() {
    try {
      const url = lastFetchRef.current
        ? `/api/driver/chat?since=${encodeURIComponent(lastFetchRef.current)}`
        : '/api/driver/chat'
      const res = await fetch(url, { cache: 'no-store' })
      if (res.status === 401) { router.replace('/login?redirect=/motorista/chat'); return }
      if (!res.ok) return
      const { data } = await res.json()
      const newMsgs: Msg[] = data.messages || []
      if (newMsgs.length === 0) return

      setMessages(prev => {
        // Merge sem duplicar (caso polling pegue msg que acabamos de enviar)
        const ids = new Set(prev.map(m => m.id))
        const merged = [...prev, ...newMsgs.filter(m => !ids.has(m.id))]
        return merged
      })
      const last = newMsgs[newMsgs.length - 1]
      if (last) lastFetchRef.current = last.created_at
    } catch { /* sem rede — tenta de novo no próximo poll */ }
  }

  // Initial load + 5s polling
  useEffect(() => {
    loadMessages()
    const id = setInterval(loadMessages, 5_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll pra fundo quando msgs mudam
  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
    initialLoadRef.current = false
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/driver/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Falha ao enviar')
        return
      }
      const { data } = await res.json()
      setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data])
      lastFetchRef.current = data.created_at
      setInput('')
    } catch { toast.error('Erro de conexão') }
    finally { setSending(false) }
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-100">
      <header className="bg-blue-700 text-white px-4 py-3 flex items-center gap-3 shadow shrink-0">
        <Link href="/motorista/rota" aria-label="Voltar" className="p-1"><ArrowLeft className="w-6 h-6" /></Link>
        <div>
          <h1 className="font-bold leading-tight">Chat com a base</h1>
          <p className="text-xs opacity-80">Operador responde em tempo real</p>
        </div>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 py-12 text-sm">
            Sem mensagens ainda. Mande a primeira!
          </div>
        )}
        {messages.map(m => (
          <Bubble key={m.id} msg={m} />
        ))}
      </div>

      <div className="p-3 bg-white border-t flex items-end gap-2"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
          placeholder="Digite uma mensagem…"
          className="flex-1 border border-gray-300 rounded-2xl px-4 py-3 text-sm resize-none max-h-32" />
        <button onClick={send} disabled={!input.trim() || sending}
          className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center disabled:opacity-50 active:scale-95">
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}

function Bubble({ msg }: { msg: Msg }) {
  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (msg.is_me) {
    return (
      <div className="flex justify-end">
        <div className="bg-blue-600 text-white rounded-2xl rounded-br-sm px-3 py-2 max-w-[75%] shadow-sm">
          <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
          <p className="text-[10px] opacity-70 text-right mt-0.5">{time}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="bg-white rounded-2xl rounded-bl-sm px-3 py-2 max-w-[75%] shadow-sm">
        <p className="text-[10px] font-semibold text-blue-600">{msg.sender_name}</p>
        <p className="text-sm whitespace-pre-wrap break-words text-gray-900">{msg.message}</p>
        <p className="text-[10px] text-gray-400 text-right mt-0.5">{time}</p>
      </div>
    </div>
  )
}
