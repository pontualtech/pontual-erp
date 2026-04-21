'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, X } from 'lucide-react'

/**
 * Pede permissão de notificação após primeiro carregamento e mostra um
 * banner discreto. Se o motorista aceita, inscreve no Push Service via
 * Service Worker e envia subscription pro backend.
 *
 * Não pede permissão automaticamente no mount (Chrome bloqueia se for
 * "spammy" — precisa user gesture). Mostra um banner com botão "Ativar
 * notificações", e o clique conta como gesto válido.
 *
 * Idempotente: se já está inscrito, não pede de novo.
 */

const VAPID_PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const DISMISS_KEY = 'pontualrota_push_dismissed'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export default function PushPermission() {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUB) return
    if (Notification.permission !== 'default') return
    // Já dispensado nas últimas 24h?
    const dis = localStorage.getItem(DISMISS_KEY)
    if (dis && Date.now() - parseInt(dis, 10) < 24 * 60 * 60 * 1000) return
    setShow(true)
  }, [])

  async function enable() {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setShow(false)
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast as BufferSource — TS infere SharedArrayBuffer-incompat por padrão
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUB) as BufferSource,
      })
      // Envia pro backend
      await fetch('/api/driver/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: {
            p256dh: arrayBufferToBase64(sub.getKey('p256dh')),
            auth: arrayBufferToBase64(sub.getKey('auth')),
          },
        }),
      })
      setShow(false)
    } catch (err) {
      console.warn('[push] subscribe error:', err)
    } finally { setBusy(false) }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-3 flex items-center gap-3">
      <Bell className="w-5 h-5 text-amber-700 shrink-0" />
      <div className="flex-1 text-sm">
        <p className="font-semibold text-amber-900 leading-tight">Receber avisos da base?</p>
        <p className="text-amber-700 text-xs mt-0.5">Mensagens chegam mesmo com app fechado</p>
      </div>
      <button type="button" onClick={enable} disabled={busy}
        className="bg-amber-600 text-white text-xs font-bold px-3 py-2 rounded-lg shadow active:scale-95 disabled:opacity-60">
        {busy ? '…' : 'Ativar'}
      </button>
      <button type="button" onClick={dismiss} aria-label="Dispensar"
        className="p-1 text-amber-700 hover:bg-amber-200 rounded">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
