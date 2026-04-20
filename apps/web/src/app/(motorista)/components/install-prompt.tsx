'use client'

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

/**
 * Botão explícito "Instalar app" que aparece assim que o Chrome dispara
 * beforeinstallprompt. Em vez de esperar o usuário achar o menu ⋮ do
 * Chrome → "Instalar app", mostramos um banner visível no topo da rota.
 *
 * Safari iOS NÃO dispara esse evento — o motorista precisa usar o botão
 * Compartilhar → "Adicionar à Tela de Início". Para iOS mostramos um
 * banner instrucional manual.
 *
 * LocalStorage guarda "install_dismissed=1" quando fechado, pra não
 * ficar pedindo toda hora. Install bem-sucedido limpa a flag.
 */

type BIPEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
}

function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    // iOS exposes this
    || (typeof navigator !== 'undefined' && 'standalone' in navigator && (navigator as any).standalone)
}

const DISMISS_KEY = 'pontualrota_install_dismissed'

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Se já estiver instalado, não mostra nada
    if (isStandalone()) return

    // Se foi fechado nas últimas 24h, pula
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 24 * 60 * 60 * 1000) {
      setDismissed(true)
    }

    const onBIP = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BIPEvent)
    }
    window.addEventListener('beforeinstallprompt', onBIP)

    const onInstalled = () => {
      setDeferred(null)
      localStorage.removeItem(DISMISS_KEY)
    }
    window.addEventListener('appinstalled', onInstalled)

    // iOS nunca dispara beforeinstallprompt — mostra hint manual
    if (isIOS() && !isStandalone()) {
      setShowIosHint(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function handleInstall() {
    if (!deferred) return
    setInstalling(true)
    try {
      await deferred.prompt()
      await deferred.userChoice
    } finally {
      setDeferred(null)
      setInstalling(false)
    }
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setDismissed(true)
  }

  if (dismissed) return null

  // Android / Desktop Chrome
  if (deferred) {
    return (
      <div className="bg-blue-600 text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <Download className="w-5 h-5 shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-semibold leading-tight">Instalar PontualRota</p>
          <p className="opacity-80 text-xs">Fica na tela inicial, funciona offline</p>
        </div>
        <button type="button" onClick={handleInstall} disabled={installing}
          className="bg-white text-blue-700 rounded-lg px-3 py-1.5 font-semibold text-xs shadow active:scale-95">
          {installing ? '…' : 'Instalar'}
        </button>
        <button type="button" onClick={handleDismiss} aria-label="Dispensar"
          className="p-1 hover:bg-white/10 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  // iOS
  if (showIosHint) {
    return (
      <div className="bg-slate-900 text-white px-4 py-3 flex items-start gap-3 shadow-md text-sm">
        <Download className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold leading-tight">Adicionar à Tela de Início</p>
          <p className="opacity-80 text-xs mt-0.5">
            No Safari: toque em <span className="inline-block px-1.5 py-0.5 bg-white/10 rounded mx-0.5">⎋ Compartilhar</span>
            {' '}→ "Adicionar à Tela de Início"
          </p>
        </div>
        <button type="button" onClick={handleDismiss} aria-label="Dispensar"
          className="p-1 hover:bg-white/10 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return null
}
