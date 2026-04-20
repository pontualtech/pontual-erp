'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'

type DriverItem = {
  driver_id: string
  driver_name: string
  avatar_url: string | null
  last_message: { text: string; sender_name: string; from_driver: boolean; at: string } | null
}

type Msg = {
  id: string
  sender_id: string
  sender_name: string
  message: string
  is_me: boolean
  is_driver: boolean
  created_at: string
}

function timeAgo(at: string | null) {
  if (!at) return ''
  const d = new Date(at)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h`
  return d.toLocaleDateString('pt-BR')
}

export default function OperatorChatPage() {
  const [drivers, setDrivers] = useState<DriverItem[]>([])
  const [activeDriverId, setActiveDriverId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const lastFetchRef = useRef<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Sidebar polling (15s)
  async function loadDrivers() {
    const res = await fetch('/api/dashboard/driver-chat', { cache: 'no-store' })
    if (!res.ok) return
    const { data } = await res.json()
    setDrivers(data.drivers || [])
  }

  useEffect(() => {
    loadDrivers()
    const id = setInterval(loadDrivers, 15_000)
    return () => clearInterval(id)
  }, [])

  // Switching driver: reset stream
  useEffect(() => {
    setMessages([])
    lastFetchRef.current = null
    if (activeDriverId) loadMessages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDriverId])

  // Polling messages of active conversation (4s)
  useEffect(() => {
    if (!activeDriverId) return
    const id = setInterval(loadMessages, 4_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDriverId])

  async function loadMessages() {
    if (!activeDriverId) return
    const url = lastFetchRef.current
      ? `/api/dashboard/driver-chat?driver_id=${activeDriverId}&since=${encodeURIComponent(lastFetchRef.current)}`
      : `/api/dashboard/driver-chat?driver_id=${activeDriverId}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return
    const { data } = await res.json()
    const newMsgs: Msg[] = data.messages || []
    if (newMsgs.length === 0) return
    setMessages(prev => {
      const ids = new Set(prev.map(m => m.id))
      return [...prev, ...newMsgs.filter(m => !ids.has(m.id))]
    })
    const last = newMsgs[newMsgs.length - 1]
    if (last) lastFetchRef.current = last.created_at
  }

  useEffect(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || !activeDriverId || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/dashboard/driver-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: activeDriverId, message: text }),
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
    } finally { setSending(false) }
  }

  const activeDriver = drivers.find(d => d.driver_id === activeDriverId)

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Sidebar lista motoristas */}
      <aside className="w-72 bg-white border-r flex flex-col">
        <div className="p-3 border-b flex items-center gap-2">
          <Link href="/logistica" className="text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-bold">Chat com Motoristas</h1>
        </div>
        <div className="flex-1 overflow-y-auto">
          {drivers.length === 0 && (
            <p className="p-4 text-sm text-gray-400 text-center">Nenhum motorista cadastrado</p>
          )}
          {drivers.map(d => (
            <button key={d.driver_id} onClick={() => setActiveDriverId(d.driver_id)}
              type="button"
              className={`w-full text-left p-3 border-b hover:bg-blue-50 ${activeDriverId === d.driver_id ? 'bg-blue-100' : ''}`}>
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{d.driver_name}</p>
                {d.last_message && (
                  <span className="text-[10px] text-gray-400">{timeAgo(d.last_message.at)}</span>
                )}
              </div>
              {d.last_message ? (
                <p className="text-xs text-gray-500 truncate mt-0.5">
                  {d.last_message.from_driver ? '' : '↩ '}{d.last_message.text}
                </p>
              ) : (
                <p className="text-xs text-gray-300 italic mt-0.5">Sem mensagens ainda</p>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Conversa ativa */}
      <main className="flex-1 flex flex-col bg-slate-100">
        {!activeDriverId ? (
          <div className="flex-1 flex items-center justify-center text-center text-gray-400">
            <div>
              <MessageCircle className="w-12 h-12 mx-auto mb-2" />
              <p>Selecione um motorista</p>
            </div>
          </div>
        ) : (
          <>
            <header className="bg-white border-b px-4 py-3 shadow-sm">
              <h2 className="font-bold">{activeDriver?.driver_name}</h2>
            </header>
            <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 py-12 text-sm">Sem mensagens</div>
              )}
              {messages.map(m => (
                <Bubble key={m.id} msg={m} />
              ))}
            </div>
            <div className="p-3 bg-white border-t flex items-end gap-2">
              <textarea value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                rows={1}
                placeholder="Mensagem para o motorista…"
                className="flex-1 border border-gray-300 rounded-2xl px-4 py-3 text-sm resize-none max-h-32" />
              <button onClick={send} type="button" disabled={!input.trim() || sending}
                className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center disabled:opacity-50 active:scale-95">
                <Send className="w-5 h-5" />
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function Bubble({ msg }: { msg: Msg }) {
  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  // is_me = operador atual; is_driver = a mensagem foi do motorista
  // Mensagens do MOTORISTA aparecem à esquerda (do operador olhar), as suas (operador) à direita
  if (msg.is_driver) {
    return (
      <div className="flex justify-start">
        <div className="bg-white rounded-2xl rounded-bl-sm px-3 py-2 max-w-[70%] shadow-sm">
          <p className="text-[10px] font-semibold text-blue-600">{msg.sender_name}</p>
          <p className="text-sm whitespace-pre-wrap break-words text-gray-900">{msg.message}</p>
          <p className="text-[10px] text-gray-400 text-right mt-0.5">{time}</p>
        </div>
      </div>
    )
  }
  // Operadores (eu ou outros)
  return (
    <div className="flex justify-end">
      <div className={`rounded-2xl rounded-br-sm px-3 py-2 max-w-[70%] shadow-sm ${msg.is_me ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'}`}>
        {!msg.is_me && (
          <p className="text-[10px] font-semibold opacity-90">{msg.sender_name}</p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
        <p className="text-[10px] opacity-70 text-right mt-0.5">{time}</p>
      </div>
    </div>
  )
}
