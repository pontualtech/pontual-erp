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
 */
export function SonaxWebphone() {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false

    async function load() {
      try {
        // Evita carregar 2x (HMR no dev / multi-render)
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

  // Componente nao renderiza nada — widget Sonax cria sua propria UI flutuante
  return null
}
