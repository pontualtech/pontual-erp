'use client'

import { useEffect, useState } from 'react'
import { PhoneOff, ArrowRightLeft, AlertCircle } from 'lucide-react'

/**
 * Controles de emergencia pra chamada ativa Sonax.
 *
 * O widget Sonax tem bug: em alguns flows (ex: acceptCall com localStorage stale)
 * o `activeCall` global do widget nao e atribuido, entao botoes Encerrar/Transferir
 * do widget falham silenciosamente. Este overlay usa `window.stack.callSession`
 * direto (a sessao SIP real, sempre presente) — bypass robusto.
 *
 * Mostra apenas quando ha chamada ativa (localStorage['webphone-incall'] = 'TRUE').
 */

declare global {
  interface Window {
    stack?: {
      callSession?: {
        hangup: () => Promise<unknown>
        transfer: (target: string) => Promise<unknown>
        mute: (enabled: boolean) => Promise<unknown>
        hold: () => Promise<unknown>
        resume: () => Promise<unknown>
      }
      oSipStack?: {
        o_stack?: { stop: () => unknown }
      }
    }
  }
}

export function SonaxCallControls() {
  const [inCall, setInCall] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferTarget, setTransferTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const tick = () => setInCall(localStorage.getItem('webphone-incall') === 'TRUE')
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  if (!inCall) return null

  async function tryHangup() {
    setBusy(true)
    setFeedback(null)
    let success = false
    let lastErr: unknown = null
    // 1. window.stack.callSession.hangup() — caminho oficial SIP
    try {
      const session = window.stack?.callSession
      if (session && typeof session.hangup === 'function') {
        await session.hangup()
        success = true
      }
    } catch (e) { lastErr = e }
    // 2. Fallback: stop SIP stack inteiro
    if (!success) {
      try {
        const inner = window.stack?.oSipStack?.o_stack
        if (inner && typeof inner.stop === 'function') {
          inner.stop()
          success = true
        }
      } catch (e) { lastErr = e }
    }
    // 3. Sempre limpa state local
    try {
      localStorage.removeItem('webphone-incall')
    } catch {}
    // 4. Avisa backend que chamada acabou (atualiza voip_calls)
    fetch('/api/voip/calls/widget-end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {})

    setFeedback(success ? 'Chamada encerrada' : `Falha: ${String(lastErr).slice(0, 80)}`)
    setBusy(false)
    setTimeout(() => setFeedback(null), 3000)
  }

  async function tryTransfer() {
    const target = transferTarget.replace(/\D/g, '')
    if (!target) { setFeedback('Digite o ramal/numero'); return }
    setBusy(true)
    setFeedback(null)
    try {
      const session = window.stack?.callSession
      if (session && typeof session.transfer === 'function') {
        await session.transfer(target)
        setFeedback(`Transferindo pra ${target}...`)
        setShowTransfer(false)
        setTransferTarget('')
      } else {
        setFeedback('Sessao SIP nao acessivel')
      }
    } catch (e) {
      setFeedback(`Falha: ${e instanceof Error ? e.message.slice(0, 80) : 'erro'}`)
    }
    setBusy(false)
    setTimeout(() => setFeedback(null), 3000)
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] bg-white rounded-lg shadow-2xl border-2 border-blue-500 p-3 flex flex-col gap-2 min-w-[280px]">
      <div className="flex items-center gap-2 text-xs text-blue-700 font-semibold">
        <AlertCircle className="h-3.5 w-3.5" />
        Controles da chamada
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={tryHangup}
          disabled={busy}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50"
        >
          <PhoneOff className="h-4 w-4" /> Encerrar
        </button>
        <button
          type="button"
          onClick={() => setShowTransfer(!showTransfer)}
          disabled={busy}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
        >
          <ArrowRightLeft className="h-4 w-4" /> Transferir
        </button>
      </div>
      {showTransfer && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={transferTarget}
            onChange={e => setTransferTarget(e.target.value)}
            placeholder="Ramal (ex: 102)"
            className="flex-1 px-2 py-1.5 text-sm border rounded-md"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') tryTransfer() }}
          />
          <button
            type="button"
            onClick={tryTransfer}
            disabled={busy || !transferTarget}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            OK
          </button>
        </div>
      )}
      {feedback && (
        <p className="text-xs text-gray-600 px-1">{feedback}</p>
      )}
    </div>
  )
}
