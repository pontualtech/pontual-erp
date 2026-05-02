'use client'

import { useEffect, useState } from 'react'
import { CloudOff, Cloud, RefreshCw, X, AlertCircle, CheckCircle } from 'lucide-react'
import { listPending, flushQueue, startAutoFlush } from '../lib/offline-queue'
import type { QueuedSubmission } from '../lib/offline-queue'

/**
 * Badge visível no header do motorista que mostra:
 *  - 🟢 Online + fila vazia → nada (ou ícone Cloud discreto)
 *  - 🟡 Online + N pendentes → "Enviando…" com counter
 *  - 🔴 Offline → "Offline — N na fila"
 *
 * UX-2 #3: Click abre modal com lista de pendentes + tempo de espera +
 * botao "Tentar agora" + vibra ao flush sucesso (feedback haptico).
 */
export default function SyncBadge() {
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [pendingList, setPendingList] = useState<QueuedSubmission[]>([])

  async function refreshCount() {
    const list = await listPending()
    setPending(list.length)
    setPendingList(list)
  }

  useEffect(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine)
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    let lastCount = -1
    async function refreshAndDetect() {
      const list = await listPending()
      // UX-2 #3: vibra ao limpar fila (motorista percebe sem olhar a tela)
      if (lastCount > 0 && list.length === 0 && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate([100, 50, 100]) } catch {}
      }
      lastCount = list.length
      setPending(list.length)
      setPendingList(list)
    }

    refreshAndDetect()
    const stop = startAutoFlush(() => void refreshAndDetect())
    const id = window.setInterval(refreshAndDetect, 5000)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearInterval(id)
      stop()
    }
  }, [])

  async function handleFlush() {
    setBusy(true)
    try {
      const res = await flushQueue()
      await refreshCount()
      if (res.sent > 0 && 'vibrate' in navigator) {
        try { navigator.vibrate([100, 50, 100]) } catch {}
      }
    }
    finally { setBusy(false) }
  }

  function handleBadgeClick() {
    if (pending === 0) return void handleFlush()
    setShowModal(true)
  }

  function fmtElapsed(ms: number): string {
    const sec = Math.floor((Date.now() - ms) / 1000)
    if (sec < 60) return `há ${sec}s`
    const min = Math.floor(sec / 60)
    if (min < 60) return `há ${min} min`
    const h = Math.floor(min / 60)
    return `há ${h}h`
  }

  // Nenhum feedback se online + fila vazia (menos ruído visual)
  if (online && pending === 0 && !busy) return null

  return (
    <>
      {!online ? (
        <button type="button" onClick={handleBadgeClick}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-500/90 text-white text-xs font-medium">
          <CloudOff className="w-3.5 h-3.5" />
          Offline{pending > 0 ? ` · ${pending} na fila` : ''}
        </button>
      ) : (
        <button type="button" onClick={handleBadgeClick} disabled={busy}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/90 text-white text-xs font-medium">
          {busy
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            : <Cloud className="w-3.5 h-3.5" />}
          {busy ? 'Enviando…' : `${pending} pendente${pending > 1 ? 's' : ''}`}
        </button>
      )}

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sync-modal-title"
          onClick={() => setShowModal(false)}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md max-h-[80dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl"
          >
            <div className="px-4 py-3 border-b flex items-center justify-between sticky top-0 bg-white">
              <h3 id="sync-modal-title" className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                {online ? <Cloud className="w-4 h-4 text-amber-600" /> : <CloudOff className="w-4 h-4 text-red-600" />}
                Sincronização
              </h3>
              <button type="button" onClick={() => setShowModal(false)} aria-label="Fechar" className="p-1 -m-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {!online && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700">
                    Você está sem internet. Suas ações ficam salvas e serão enviadas automaticamente quando a rede voltar.
                  </p>
                </div>
              )}

              {pendingList.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500" />
                  <p className="text-sm font-semibold text-gray-700">Tudo em dia!</p>
                  <p className="text-xs">Nenhuma ação pendente.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    {pendingList.length} aguardando envio
                  </p>
                  {pendingList.map((it) => {
                    const isFailed = it.status === 'failed'
                    const action = it.endpoint.includes('coleta') ? 'Coleta' : it.endpoint.includes('entrega') ? 'Entrega' : 'Ação'
                    return (
                      <div
                        key={it.id}
                        className={`rounded-lg border p-3 ${isFailed ? 'border-red-300 bg-red-50' : 'border-amber-200 bg-amber-50'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{action}</p>
                            <p className="text-[11px] text-gray-600">
                              {fmtElapsed(it.created_at)} · {it.attempts} tentativa{it.attempts !== 1 ? 's' : ''}
                            </p>
                            {isFailed && it.last_error && (
                              <p className="text-[10px] text-red-700 mt-1 break-words line-clamp-2">{it.last_error}</p>
                            )}
                          </div>
                          {isFailed ? (
                            <span className="text-[10px] font-bold uppercase text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                              Falhou
                            </span>
                          ) : (
                            <RefreshCw className={`w-4 h-4 text-amber-600 flex-shrink-0 ${busy ? 'animate-spin' : ''}`} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={handleFlush}
                disabled={busy || (!online && pending > 0)}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 min-h-[44px]"
              >
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {!online ? 'Sem internet' : 'Tentar enviar agora'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
