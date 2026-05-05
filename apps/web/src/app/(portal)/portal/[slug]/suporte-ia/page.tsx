'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { readPortalCompany, readPortalCustomer } from '@/lib/portal-auth-storage'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Minha impressora nao liga',
  'Papel atolando na impressora',
  'Impressao com manchas',
  'Erro no painel da impressora',
  'Como limpar cabeca de impressao',
]

export default function SuporteIAPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [company, setCompany] = useState<{ name: string; whatsapp?: string; phone?: string } | null>(null)
  const [customer, setCustomer] = useState<{ name: string }  | null>(null)

  // UX-1 #5: link wa.me pra escapar do bot quando nao resolve
  function buildWhatsappEscape(): string | null {
    const raw = company?.whatsapp || company?.phone
    if (!raw) return null
    const digits = raw.replace(/\D/g, '')
    if (!digits || digits.length < 10) return null
    const text = encodeURIComponent(`Ola! Vim do portal de ${company?.name || 'atendimento'} e gostaria de falar com uma pessoa.`)
    return `https://wa.me/${digits.startsWith('55') ? digits : `55${digits}`}?text=${text}`
  }
  const waEscape = buildWhatsappEscape()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const savedCompany = localStorage.getItem('portal_company')
    const savedCustomer = localStorage.getItem('portal_customer')
    // Sprint UX-32: parse seguro centralizado
    if (savedCompany) { const c = readPortalCompany(); if (c) setCompany(c as any) }
    if (savedCustomer) { const u = readPortalCustomer(); if (u) setCustomer(u as any) }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(text?: string) {
    const msg = (text || input).trim()
    if (!msg || loading) return

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: msg }
    const allMessages = [...messages, userMsg]
    setMessages(allMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/portal/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages.map(m => ({ role: m.role, content: m.content })),
          session_id: sessionId,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error || 'Erro ao processar')
        return
      }

      // Check if streaming or JSON
      const contentType = res.headers.get('content-type') || ''
      const newSessionId = res.headers.get('x-session-id')
      if (newSessionId) setSessionId(newSessionId)

      if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
        // Streaming response
        const reader = res.body?.getReader()
        const decoder = new TextDecoder()
        let assistantContent = ''
        const assistantId = `asst-${Date.now()}`

        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

        while (reader) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })

          // Parse AI SDK data stream format
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('0:')) {
              // Text chunk
              try {
                const text = JSON.parse(line.slice(2))
                assistantContent += text
                setMessages(prev =>
                  prev.map(m => m.id === assistantId ? { ...m, content: assistantContent } : m)
                )
              } catch {}
            }
          }
        }
      } else {
        // JSON response (fallback when no API key)
        const data = await res.json()
        if (data.session_id) setSessionId(data.session_id)

        setMessages(prev => [
          ...prev,
          { id: `asst-${Date.now()}`, role: 'assistant', content: data.content || 'Sem resposta' },
        ])
      }
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleNewChat() {
    setMessages([])
    setSessionId(null)
    inputRef.current?.focus()
  }

  function handleLogout() {
    localStorage.removeItem('portal_customer')
    localStorage.removeItem('portal_company')
    fetch('/api/portal/logout', { method: 'POST' })
      .finally(() => router.push(`/portal/${slug}/login`))
  }

  const firstName = customer?.name?.split(' ')[0] || 'Cliente'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/portal/${slug}`} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Suporte IA</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">{company?.name || 'Assistente Tecnica'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {waEscape && (
              <a
                href={waEscape}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
                aria-label="Falar com atendente humano via WhatsApp"
                title="Falar com pessoa"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4l-2-1c-.2-.1-.5-.1-.7.1l-.9 1c-1-.5-2.4-1.9-3-2.9l1-.9c.2-.2.2-.5.1-.7l-1-2c-.2-.4-.7-.6-1.1-.4l-1 .5c-.5.2-.7.7-.5 1.2.6 2 2.7 4.6 4.6 5.6.5.2 1 .1 1.2-.4l.5-1c.2-.4 0-.9-.4-1.1zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.8L2 22l5.4-1.3c1.3.8 3 1.3 4.6 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>
                Falar com pessoa
              </a>
            )}
            <button
              type="button"
              onClick={handleNewChat}
              className="text-xs text-blue-600 dark:text-blue-400 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
            >
              Nova conversa
            </button>
            <button onClick={handleLogout} className="text-sm text-red-600 dark:text-red-400 font-medium px-2 py-1">Sair</button>
          </div>
        </div>
      </header>

      {/* Chat area */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-4 flex flex-col">
        {messages.length === 0 ? (
          /* Welcome state */
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <div className="w-16 h-16 bg-violet-100 dark:bg-violet-900 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              Ola, {firstName}!
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md">
              Sou a assistente tecnica virtual. Posso ajudar com duvidas sobre impressoras, scanners, notebooks e outros equipamentos.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleSend(s)}
                  className="text-sm px-4 py-2 rounded-full border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-950 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="flex-1 space-y-4 overflow-y-auto pb-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 dark:bg-blue-500 text-white'
                    : 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-zinc-700'
                }`}>
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="w-4 h-4 bg-violet-600 rounded flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <span className="text-xs font-medium text-violet-600 dark:text-violet-400">Assistente IA</span>
                    </div>
                  )}
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  {msg.role === 'assistant' && msg.content && (
                    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-zinc-700 flex items-center gap-3">
                      <Link
                        href={`/portal/${slug}/tickets`}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Abrir ticket com tecnico
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Input */}
        <div className="sticky bottom-0 bg-gray-50 dark:bg-zinc-950 pt-2 pb-4">
          {/* Banner contextual: aparece apos 4+ msgs sugerindo escape humano (UX-1 #5) */}
          {waEscape && messages.length >= 4 && (
            <div className="mb-2 rounded-xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-900 p-3 flex items-center gap-3">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4l-2-1c-.2-.1-.5-.1-.7.1l-.9 1c-1-.5-2.4-1.9-3-2.9l1-.9c.2-.2.2-.5.1-.7l-1-2c-.2-.4-.7-.6-1.1-.4l-1 .5c-.5.2-.7.7-.5 1.2.6 2 2.7 4.6 4.6 5.6.5.2 1 .1 1.2-.4l.5-1c.2-.4 0-.9-.4-1.1zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.8L2 22l5.4-1.3c1.3.8 3 1.3 4.6 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-300">A IA não resolveu?</p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Fale com nossa equipe pelo WhatsApp.</p>
              </div>
              <a
                href={waEscape}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg min-h-[40px] flex items-center"
              >
                Conversar
              </a>
            </div>
          )}
          <form
            onSubmit={e => { e.preventDefault(); handleSend() }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Digite sua duvida..."
              disabled={loading}
              className="flex-1 px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none disabled:opacity-50"
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-5 py-3 bg-violet-600 dark:bg-violet-500 text-white rounded-xl font-semibold hover:bg-violet-700 dark:hover:bg-violet-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
          <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-2">
            IA pode cometer erros. Verifique informacoes importantes.
          </p>
        </div>
      </main>
    </div>
  )
}
