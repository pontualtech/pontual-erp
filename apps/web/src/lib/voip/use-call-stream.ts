'use client'

import { useEffect, useRef } from 'react'

/**
 * Singleton EventSource pro /api/voip/calls/stream.
 *
 * Eco audit 10/06: antes CallToast + MissedCallsBell + VoipDashboardCard cada
 * um abria seu PROPRIO `new EventSource(...)` → 3 conexoes SSE persistentes por
 * aba/user no servidor. Agora 1 conexao compartilhada com fan-out pros
 * subscribers. Mesmo padrao de cache global de lib/use-avisos.ts.
 *
 * Cada handler recebe o evento JA parseado. Reconexao com backoff exponencial
 * (1s → 30s), identica a logica que estava duplicada nos 3 componentes.
 * A conexao abre lazy no 1o subscriber e fecha quando o ultimo sai.
 */

type CallStreamHandler = (ev: any) => void

const listeners = new Set<CallStreamHandler>()
let es: EventSource | null = null
let stopped = false
let retryDelay = 1000
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function connect() {
  if (stopped || typeof window === 'undefined') return
  es = new EventSource('/api/voip/calls/stream')
  es.onopen = () => { retryDelay = 1000 }
  es.onmessage = (e) => {
    let ev: any
    try { ev = JSON.parse(e.data) } catch { return }
    // Repassa tudo (inclusive 'hello'); cada handler filtra o que importa.
    listeners.forEach(fn => { try { fn(ev) } catch { /* handler isolado */ } })
  }
  es.onerror = () => {
    es?.close()
    es = null
    if (stopped) return
    reconnectTimer = setTimeout(connect, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 30_000) // exp backoff até 30s
  }
}

function subscribe(handler: CallStreamHandler): () => void {
  listeners.add(handler)
  // Abre a conexao no 1o subscriber (ou se foi fechada e voltou alguem)
  if (!es && !reconnectTimer) {
    stopped = false
    connect()
  }
  return () => {
    listeners.delete(handler)
    // Sem mais ninguem ouvindo → fecha a conexao (libera SSE no servidor)
    if (listeners.size === 0) {
      stopped = true
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      es?.close()
      es = null
    }
  }
}

/**
 * Hook: inscreve um handler no stream compartilhado de eventos de chamada.
 * O handler recebe o evento parseado. Cleanup automatico no unmount.
 */
export function useCallStream(handler: CallStreamHandler) {
  // Ref pattern: subscreve UMA vez (conexao estavel) mas sempre chama o handler
  // mais recente — evita stale closure sem re-subscrever a cada render.
  const ref = useRef(handler)
  useEffect(() => { ref.current = handler })
  useEffect(() => {
    const unsub = subscribe((ev) => ref.current(ev))
    return unsub
  }, [])
}
