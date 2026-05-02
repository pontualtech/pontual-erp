'use client'

import { useEffect } from 'react'

/**
 * UX-6 #1: registra Service Worker do portal cliente em /portal/sw.js.
 * Scope = /portal/. Funciona em portal.pontualtech.com.br + variantes.
 *
 * Estratégia idêntica ao motorista (sw-register.tsx) — minimal, fail-safe:
 *  - Se navegador não suporta SW, no-op
 *  - Se registro falha, console.warn (não quebra app)
 */
export default function PortalSwRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    // Só registra em produção pra não confundir devtools em dev
    if (process.env.NODE_ENV !== 'production') return

    const onLoad = () => {
      navigator.serviceWorker
        .register('/portal/sw.js', { scope: '/portal/' })
        .catch((err) => console.warn('[portal-sw] registro falhou:', err))
    }

    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}
