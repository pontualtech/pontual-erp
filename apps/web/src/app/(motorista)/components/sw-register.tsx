'use client'

import { useEffect } from 'react'

/**
 * Registra /motorista/sw.js com scope limitado a /motorista/.
 *
 * Critical: scope=/motorista/ pra não interferir com ERP dashboard ou
 * portal do cliente. Um SW com escopo largo poderia cachear rotas
 * alheias e quebrar ambiente do operador.
 *
 * Só roda no browser (useEffect), produção ou dev — sem ifs desnecessários.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/motorista/sw.js', { scope: '/motorista/' })
      .catch(err => {
        // Falha aqui não deve quebrar o app — só limita offline capability
        console.warn('[SW] Registration failed:', err?.message || err)
      })
  }, [])
  return null
}
