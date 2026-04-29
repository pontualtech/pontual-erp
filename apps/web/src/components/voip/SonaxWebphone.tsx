'use client'

import { useEffect, useState } from 'react'

/**
 * Carrega o widget Sonax Webphone (atendimento embedded no navegador)
 * dinamicamente baseado no ramal do user logado.
 *
 * O widget Sonax injeta uma UI flutuante propria — nao precisamos renderizar
 * nada manual aqui, so colocar o <script> com o data/dataClient certo.
 *
 * Mounted no dashboard layout, so carrega se user tem ramal mapeado.
 *
 * Tambem observa localStorage['webphone-incall'] pra fechar registro outbound
 * (criado por widget-dial) quando o user encerra a chamada — Sonax nao manda
 * webhook pra outbound do widget, entao precisamos detectar fim client-side.
 */
export function SonaxWebphone() {
  const [, setLoaded] = useState(false)
  const [, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false

    async function load() {
      try {
        if (document.getElementById('widget-script')) {
          setLoaded(true)
          return
        }
        const r = await fetch('/api/voip/webphone-token', { cache: 'no-store' })
        if (!r.ok) {
          if (r.status !== 404) {
            const j = await r.json().catch(() => ({}))
            setError(typeof j.error === 'string' ? j.error : `Falha ${r.status}`)
          }
          return
        }
        const j = await r.json()
        const { token, dataClient } = j.data || {}
        if (!token || !dataClient || cancelled) return

        const script = document.createElement('script')
        script.id = 'widget-script'
        script.src = `https://webphone2.sonax.cloud/widget?data=${encodeURIComponent(token)}&dataClient=${encodeURIComponent(dataClient)}`
        script.async = true
        script.onload = () => setLoaded(true)
        script.onerror = () => setError('Falha ao carregar widget Sonax')
        document.body.appendChild(script)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro desconhecido')
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // Observer: detecta transicao 'TRUE' -> null no localStorage['webphone-incall']
  // (widget Sonax limpa essa flag quando a chamada encerra). Ao detectar, dispara
  // POST /api/voip/calls/widget-end pra fechar o registro outbound criado por
  // widget-dial. Sem isso, a chamada fica pendurada em "Tocando" ate o cron de
  // 30min marcar como failed.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let prev = localStorage.getItem('webphone-incall')
    let lastEnded = 0

    const interval = setInterval(() => {
      const cur = localStorage.getItem('webphone-incall')
      if (prev === 'TRUE' && cur !== 'TRUE') {
        // Transicao "em chamada" -> "idle": chamada acabou
        const now = Date.now()
        if (now - lastEnded < 5000) {
          // debounce — evita disparar 2x se localStorage flicker
        } else {
          lastEnded = now
          fetch('/api/voip/calls/widget-end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }).catch(() => {})
        }
      }
      prev = cur
    }, 1500)

    return () => clearInterval(interval)
  }, [])

  return null
}
