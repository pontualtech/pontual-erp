'use client'

import { useEffect, useState } from 'react'
import { CloudOff, Cloud, RefreshCw } from 'lucide-react'
import { listPending, flushQueue, startAutoFlush } from '../lib/offline-queue'

/**
 * Badge visível no header do motorista que mostra:
 *  - 🟢 Online + fila vazia → nada (ou ícone Cloud discreto)
 *  - 🟡 Online + N pendentes → "Enviando…" com counter
 *  - 🔴 Offline → "Offline — N na fila"
 *
 * Ao clicar, força flush manual (usuário sente que pode agir).
 */
export default function SyncBadge() {
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(true)
  const [busy, setBusy] = useState(false)

  async function refreshCount() {
    const list = await listPending()
    setPending(list.length)
  }

  useEffect(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine)
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    refreshCount()
    const stop = startAutoFlush(() => void refreshCount())
    const id = window.setInterval(refreshCount, 5000)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearInterval(id)
      stop()
    }
  }, [])

  async function handleClick() {
    setBusy(true)
    try { await flushQueue(); await refreshCount() }
    finally { setBusy(false) }
  }

  // Nenhum feedback se online + fila vazia (menos ruído visual)
  if (online && pending === 0 && !busy) return null

  if (!online) {
    return (
      <button type="button" onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/90 text-white text-xs font-medium">
        <CloudOff className="w-3.5 h-3.5" />
        Offline{pending > 0 ? ` · ${pending} na fila` : ''}
      </button>
    )
  }

  return (
    <button type="button" onClick={handleClick} disabled={busy}
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/90 text-white text-xs font-medium">
      {busy
        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        : <Cloud className="w-3.5 h-3.5" />}
      {busy ? 'Enviando…' : `${pending} pendente${pending > 1 ? 's' : ''}`}
    </button>
  )
}
