'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

/**
 * Atalhos de teclado globais inspirados em Gmail (g + letra) e GitHub (?).
 *
 * UX-3 #1: atendente / gerente sem mouse pode navegar rápido.
 *
 * Atalhos:
 *  g + o → /os (lista OS)
 *  g + c → /clientes
 *  g + d → / (dashboard)
 *  g + f → /financeiro
 *  n     → /os/novo (nova OS rapida — teclado central, atalho do atendente)
 *  ?     → mostra modal de ajuda com lista de atalhos
 *
 * Boa prática: ignora atalhos quando foco esta em <input>, <textarea>, <select>
 * ou contenteditable — pra nao interferir com digitacao.
 */
export function useKeyboardShortcuts() {
  const router = useRouter()
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    let gPressed = false
    let gTimer: ReturnType<typeof setTimeout> | null = null

    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (el.isContentEditable) return true
      return false
    }

    function clearG() {
      gPressed = false
      if (gTimer) { clearTimeout(gTimer); gTimer = null }
    }

    function go(path: string, label: string) {
      router.push(path)
      toast.success(label, { duration: 1200 })
    }

    function onKey(e: KeyboardEvent) {
      // Bypass quando user esta digitando ou tem modificador (ctrl/cmd/alt)
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // ? → modal ajuda (precisa shift, '?' = shift + /)
      if (e.key === '?') {
        e.preventDefault()
        setShowHelp(s => !s)
        return
      }

      // g é o "modo prefixo" — espera proxima tecla por 1.5s
      if (e.key === 'g' && !gPressed) {
        gPressed = true
        if (gTimer) clearTimeout(gTimer)
        gTimer = setTimeout(clearG, 1500)
        return
      }

      // Sequencia g+letra
      if (gPressed) {
        switch (e.key) {
          case 'o': go('/os', 'Ir: OS'); break
          case 'c': go('/clientes', 'Ir: Clientes'); break
          case 'd': go('/', 'Ir: Dashboard'); break
          case 'f': go('/financeiro', 'Ir: Financeiro'); break
          default: clearG(); return
        }
        clearG()
        return
      }

      // Atalho direto: n → nova OS (atendente preenche dezenas/dia)
      if (e.key === 'n') {
        e.preventDefault()
        go('/os/novo', 'Nova OS')
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (gTimer) clearTimeout(gTimer)
    }
  }, [router])

  return { showHelp, setShowHelp }
}

export const SHORTCUT_HELP = [
  { keys: ['g', 'd'], label: 'Ir para Dashboard' },
  { keys: ['g', 'o'], label: 'Ir para lista de OS' },
  { keys: ['g', 'c'], label: 'Ir para Clientes' },
  { keys: ['g', 'f'], label: 'Ir para Financeiro' },
  { keys: ['n'], label: 'Nova OS' },
  { keys: ['?'], label: 'Mostrar/ocultar esta ajuda' },
] as const
