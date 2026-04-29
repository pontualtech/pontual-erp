'use client'

import { useEffect, useRef, useState } from 'react'
import { Phone, Delete, X, Loader2, ArrowRightLeft, Info } from 'lucide-react'

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
]

const FAC_CODES: Array<{ code: string; label: string }> = [
  { code: '*72', label: 'Transferência cega (blind)' },
  { code: '*73', label: 'Transferência atendida' },
  { code: '*8', label: 'Captura de chamada' },
  { code: '*43', label: 'Echo test (debug ramal)' },
]

function formatTyped(raw: string) {
  const d = raw.replace(/[^\d*#]/g, '')
  // Mostra (DD) NNNNN-NNNN para 11 dígitos
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return raw
}

interface Props {
  triggerLabel?: string
  /** Renderizar como botão flutuante fixed bottom-right (default true) */
  floating?: boolean
}

export function Dialpad({ triggerLabel = 'Discar', floating = true }: Props) {
  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState('')
  const [calling, setCalling] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [showFac, setShowFac] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  // Fecha modal com ESC
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
      // Atalhos teclado: digitar 0-9 * # adiciona; Backspace remove; Enter liga
      if (/^[0-9*#]$/.test(e.key)) setNumber(prev => prev + e.key)
      else if (e.key === 'Backspace') setNumber(prev => prev.slice(0, -1))
      else if (e.key === 'Enter' && !calling) doCall()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, calling, number])

  function append(k: string) {
    setNumber(prev => prev + k)
    setFeedback(null)
  }

  function backspace() {
    setNumber(prev => prev.slice(0, -1))
  }

  function clear() {
    setNumber('')
    setFeedback(null)
  }

  async function doCall() {
    const cleaned = number.replace(/[^\d]/g, '')
    if (cleaned.length < 4) {
      setFeedback({ kind: 'err', msg: 'Digite ao menos 4 dígitos' })
      return
    }
    setCalling(true)
    setFeedback(null)
    try {
      const r = await fetch('/api/voip/click-to-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleaned }),
      })
      const d = await r.json()
      if (!r.ok) {
        setFeedback({ kind: 'err', msg: typeof d.error === 'string' ? d.error : 'Falha ao iniciar' })
        return
      }
      setFeedback({ kind: 'ok', msg: d.data?.message || 'Chamada iniciada — atende no Linphone' })
      // Mantém modal aberto pra atendente confirmar; auto-close após 4s
      setTimeout(() => { setOpen(false); setNumber(''); setFeedback(null) }, 4000)
    } catch {
      setFeedback({ kind: 'err', msg: 'Erro de rede' })
    } finally {
      setCalling(false)
    }
  }

  if (!open) {
    if (!floating) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border rounded-md hover:bg-gray-50"
        >
          <Phone className="h-4 w-4" /> {triggerLabel}
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[9000] flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-transform hover:scale-105"
        aria-label="Abrir discador"
        title="Discador (Ctrl+Shift+D)"
      >
        <Phone className="h-6 w-6" />
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/40"
      onClick={() => !calling && setOpen(false)}
    >
      <div
        ref={popRef}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-blue-600" />
            <h2 className="font-semibold dark:text-gray-100">Discador</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={calling}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="tel"
              inputMode="tel"
              value={formatTyped(number)}
              onChange={e => setNumber(e.target.value.replace(/[^\d*#]/g, ''))}
              placeholder="Digite o número"
              className="flex-1 px-3 py-2 text-lg font-mono text-center border rounded-md dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={backspace}
              disabled={!number}
              className="p-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              aria-label="Apagar"
            >
              <Delete className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {KEYS.flat().map(k => (
              <button
                key={k}
                type="button"
                onClick={() => append(k)}
                disabled={calling}
                className="h-12 text-xl font-semibold border rounded-md hover:bg-blue-50 dark:hover:bg-blue-900 dark:border-gray-700 dark:text-gray-100 active:bg-blue-100 disabled:opacity-50"
              >
                {k}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={doCall}
            disabled={calling || number.length < 4}
            className="w-full inline-flex items-center justify-center gap-2 py-3 text-base font-semibold bg-green-600 hover:bg-green-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {calling ? <Loader2 className="h-5 w-5 animate-spin" /> : <Phone className="h-5 w-5" />}
            {calling ? 'Iniciando...' : 'Ligar'}
          </button>

          {feedback && (
            <div className={`text-sm rounded-md px-3 py-2 ${feedback.kind === 'ok' ? 'bg-green-50 text-green-800 dark:bg-green-900 dark:text-green-100' : 'bg-red-50 text-red-800 dark:bg-red-900 dark:text-red-100'}`}>
              {feedback.msg}
            </div>
          )}

          <div className="border-t dark:border-gray-700 pt-3">
            <button
              type="button"
              onClick={() => setShowFac(!showFac)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <ArrowRightLeft className="h-3 w-3" />
              {showFac ? 'Ocultar' : 'Ver'} códigos de transferência
            </button>
            {showFac && (
              <ul className="mt-2 space-y-1 text-xs">
                {FAC_CODES.map(f => (
                  <li key={f.code} className="flex items-center justify-between gap-2 text-gray-600 dark:text-gray-300">
                    <span><strong className="font-mono text-gray-900 dark:text-gray-100">{f.code}</strong> · {f.label}</span>
                    <button
                      type="button"
                      onClick={() => setNumber(f.code)}
                      className="text-blue-600 hover:underline"
                    >
                      usar
                    </button>
                  </li>
                ))}
                <li className="flex items-start gap-1 mt-2 text-[11px] text-gray-500">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>Códigos discados durante uma chamada ativa no Linphone (não daqui). Use este painel só pra consultar os códigos.</span>
                </li>
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
