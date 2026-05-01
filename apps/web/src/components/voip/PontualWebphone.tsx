'use client'

import { useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, ArrowRightLeft, Mic, MicOff, X, Minimize2 } from 'lucide-react'

/**
 * PontualWebphone — substitui SonaxWebphone usando SIP.js direto contra
 * Asterisk proprio (pabx.pontualtech.work).
 *
 * Arquitetura:
 *   Browser (SimpleUser SIP.js)
 *     -> wss://pabx.pontualtech.work/ws (Traefik TLS termination)
 *     -> Asterisk HTTP server :8088/ws (network_mode: host)
 *     -> pjsip endpoint (transport-ws + ramal-template-webrtc)
 *
 * Credenciais lidas de /api/voip/pontual-webphone/credentials (banco voip_extensions).
 */

// SIP.js dynamic import (ssr-incompatible)
type SIPSimpleUser = any
type SIPSession = any
type SimpleUserModule = any

interface CallState {
  state: 'idle' | 'calling' | 'incoming' | 'connected' | 'ended'
  remoteNumber?: string
  remoteName?: string
  startedAt?: number
}

export function PontualWebphone() {
  const [state, setState] = useState<CallState>({ state: 'idle' })
  const [registered, setRegistered] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [dialNumber, setDialNumber] = useState('')
  const [showDialer, setShowDialer] = useState(false)
  const [transferTarget, setTransferTarget] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)
  const [callDuration, setCallDuration] = useState(0)

  const userRef = useRef<SIPSimpleUser | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false

    async function init() {
      console.log('[PontualPABX] init() iniciado')
      try {
        console.log('[PontualPABX] fetching /api/voip/pontual-webphone/credentials')
        const credRes = await fetch('/api/voip/pontual-webphone/credentials', { cache: 'no-store' })
        console.log('[PontualPABX] credentials HTTP', credRes.status)
        if (!credRes.ok) {
          if (credRes.status !== 404) {
            const j = await credRes.json().catch(() => ({}))
            setError(typeof j.error === 'string' ? j.error : (j.error?.message || `Falha ${credRes.status}`))
          }
          return
        }
        const { data } = await credRes.json()
        console.log('[PontualPABX] credentials:', { ramal: data?.ramal, domain: data?.domain, wsUrl: data?.wsUrl, displayName: data?.displayName })
        if (!data?.wsUrl || cancelled) return

        const sipMod: SimpleUserModule = await import('sip.js')
        const SimpleUser = sipMod.Web?.SimpleUser || sipMod.SimpleUser

        // Audio element pro remote stream
        if (!audioRef.current) {
          const audio = new Audio()
          audio.autoplay = true
          audioRef.current = audio
          document.body.appendChild(audio)
        }

        const simpleUser = new SimpleUser(data.wsUrl, {
          aor: `sip:${data.ramal}@${data.domain}`,
          delegate: {
            onCallReceived: (session: SIPSession) => {
              console.log('[PontualPABX] onCallReceived from', session?.remoteIdentity?.uri?.user)
              setState({
                state: 'incoming',
                remoteNumber: session?.remoteIdentity?.uri?.user || '?',
                remoteName: session?.remoteIdentity?.displayName || undefined,
              })
            },
            onCallAnswered: () => {
              console.log('[PontualPABX] onCallAnswered')
              setState(prev => ({ ...prev, state: 'connected', startedAt: Date.now() }))
              startTimer()
            },
            onCallHangup: () => {
              console.log('[PontualPABX] onCallHangup')
              setState({ state: 'ended' })
              stopTimer()
              setTimeout(() => setState({ state: 'idle' }), 1500)
            },
            onCallCreated: () => {
              console.log('[PontualPABX] onCallCreated')
              setState(prev => ({ ...prev, state: 'calling' }))
            },
          },
          media: {
            constraints: { audio: true, video: false },
            remote: { audio: audioRef.current },
          },
          userAgentOptions: {
            authorizationUsername: data.ramal,
            authorizationPassword: data.password,
            displayName: data.displayName,
            transportOptions: {
              server: data.wsUrl,
            },
            // logLevel 'log' ao invés de 'warn' — muito útil pra debug.
            // Trocar pra 'warn' depois que estabilizar.
            logLevel: 'log',
          },
        })

        userRef.current = simpleUser
        console.log('[PontualPABX] SimpleUser instanciado, conectando WSS...')

        await simpleUser.connect()
        console.log('[PontualPABX] WSS conectado, REGISTER...')
        await simpleUser.register()
        console.log('[PontualPABX] REGISTER ok, bolinha verde')
        if (!cancelled) setRegistered(true)
      } catch (e) {
        console.error('[PontualPABX] init() error:', e)
        if (!cancelled) setError(e instanceof Error ? e.message.slice(0, 100) : 'erro')
      }
    }

    init()

    return () => {
      cancelled = true
      stopTimer()
      try { userRef.current?.disconnect?.() } catch {}
    }
  }, [])

  function startTimer() {
    stopTimer()
    timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000)
  }
  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    setCallDuration(0)
  }

  async function call(target: string) {
    console.log('[PontualPABX] call() chamado com target=', target)
    const num = target.replace(/\D/g, '')
    if (!num) {
      console.warn('[PontualPABX] call() abortado: num vazio')
      setError('Número vazio')
      return
    }
    if (!userRef.current) {
      console.warn('[PontualPABX] call() abortado: userRef.current é null (SimpleUser não inicializado)')
      setError('Webphone ainda não está pronto. Aguarde a bolinha verde.')
      return
    }
    const host = (userRef.current as any).userAgent?.configuration?.uri?.host || 'pabx.pontualtech.work'
    const targetUri = `sip:${num}@${host}`
    console.log('[PontualPABX] dispatching INVITE to', targetUri)
    try {
      await userRef.current.call(targetUri)
      console.log('[PontualPABX] call() resolveu (INVITE enviado, aguardando 100/180/200)')
      setState({ state: 'calling', remoteNumber: num })
    } catch (e) {
      console.error('[PontualPABX] call() throw:', e)
      setError(e instanceof Error ? e.message.slice(0, 100) : 'falha discar')
    }
  }

  async function answer() {
    console.log('[PontualPABX] answer() chamado')
    if (!userRef.current) {
      console.warn('[PontualPABX] answer() abortado: userRef.current é null')
      setError('Webphone não está pronto')
      return
    }
    try {
      console.log('[PontualPABX] dispatching answer() via SimpleUser')
      await userRef.current.answer()
      console.log('[PontualPABX] answer() resolveu (200 OK enviado)')
    } catch (e) {
      console.error('[PontualPABX] answer() throw:', e)
      setError('Falha atender: ' + (e instanceof Error ? e.message.slice(0, 100) : 'erro'))
      // Limpa estado pra não travar UI no modal de incoming.
      setState({ state: 'idle' })
    }
  }

  async function hangup() {
    try {
      await userRef.current?.hangup()
    } catch (e) {
      // se nao tiver sessao, limpa estado mesmo assim
      setState({ state: 'idle' })
      stopTimer()
    }
  }

  async function toggleMute() {
    const isMuted = userRef.current?.isMuted?.() ?? false
    try {
      if (isMuted) await userRef.current?.unmute?.()
      else await userRef.current?.mute?.()
      setMuted(!isMuted)
    } catch {}
  }

  async function doTransfer() {
    const target = transferTarget.replace(/\D/g, '')
    if (!target || !userRef.current) return
    try {
      const uri = `sip:${target}@${userRef.current.userAgent.configuration.uri.host}`
      await userRef.current.transfer?.(uri) || await userRef.current.session?.refer?.(uri)
      setShowTransfer(false)
      setTransferTarget('')
    } catch (e) {
      setError('Falha transferir: ' + (e instanceof Error ? e.message.slice(0, 80) : 'erro'))
    }
  }

  // Status pill: nao mostra widget se nao tem credenciais (user sem ramal)
  if (error?.includes('nao tem ramal')) return null

  const inActiveCall = state.state === 'connected' || state.state === 'calling'
  const fmtDur = (s: number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`

  return (
    <>
      {/* FAB ramal ativo (canto inferior direito) */}
      <div className="fixed bottom-4 right-4 z-[9000]">
        <button
          type="button"
          onClick={() => setShowDialer(!showDialer)}
          title={registered ? 'Webphone PontualPABX (conectado)' : 'Webphone (conectando...)'}
          className={`flex items-center gap-2 px-4 py-3 rounded-full shadow-2xl transition ${
            registered ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-400 text-white'
          }`}
        >
          <Phone className="h-5 w-5" />
          <span className={`h-2 w-2 rounded-full ${registered ? 'bg-green-400' : 'bg-yellow-300'}`} />
          <span className="text-xs font-medium hidden sm:inline">PontualPABX</span>
        </button>
      </div>

      {/* Dialer (canto inferior direito quando expandido) */}
      {showDialer && state.state === 'idle' && (
        <div className="fixed bottom-20 right-4 z-[9100] w-72 bg-white rounded-lg shadow-2xl border border-blue-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-blue-900 flex items-center gap-1">
              <Phone className="h-4 w-4" /> Discar
            </h3>
            <button type="button" onClick={() => setShowDialer(false)}>
              <X className="h-4 w-4 text-gray-500 hover:text-gray-900" />
            </button>
          </div>
          <input
            type="text"
            value={dialNumber}
            onChange={e => setDialNumber(e.target.value)}
            placeholder="Número (ex: 11999998888 ou 102)"
            className="w-full px-3 py-2 border rounded-md text-sm"
            onKeyDown={e => { if (e.key === 'Enter') call(dialNumber) }}
          />
          <button
            type="button"
            onClick={() => call(dialNumber)}
            disabled={!registered || !dialNumber}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium disabled:opacity-50"
          >
            <Phone className="h-4 w-4" /> Ligar
          </button>
          {!registered && <p className="text-xs text-amber-600">Conectando ao PABX...</p>}
        </div>
      )}

      {/* Incoming call modal */}
      {state.state === 'incoming' && (
        <div className="fixed top-4 right-4 z-[9999] w-80 bg-white rounded-lg shadow-2xl border-2 border-green-500 p-4 animate-pulse">
          <p className="text-xs uppercase text-green-700 font-semibold">Chamada recebida</p>
          <p className="text-lg font-semibold text-gray-900 mt-1">{state.remoteName || state.remoteNumber}</p>
          <p className="text-sm text-gray-500 font-mono">{state.remoteNumber}</p>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={answer} className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md">
              <Phone className="h-4 w-4" /> Atender
            </button>
            <button type="button" onClick={hangup} className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md">
              <PhoneOff className="h-4 w-4" /> Recusar
            </button>
          </div>
        </div>
      )}

      {/* Active call panel (bottom-center) */}
      {inActiveCall && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-96 bg-white rounded-lg shadow-2xl border-2 border-blue-500 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-blue-700 font-semibold">
                {state.state === 'calling' ? 'Chamando…' : 'Em chamada'}
              </p>
              <p className="text-lg font-semibold text-gray-900">{state.remoteName || state.remoteNumber}</p>
              {state.state === 'connected' && <p className="text-xs text-gray-500">{fmtDur(callDuration)}</p>}
            </div>
            <span className={`h-3 w-3 rounded-full ${state.state === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={hangup} className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md">
              <PhoneOff className="h-4 w-4" /> Encerrar
            </button>
            <button type="button" onClick={toggleMute} disabled={state.state !== 'connected'} className="inline-flex items-center justify-center gap-1 px-3 py-2 border rounded-md text-sm font-medium disabled:opacity-50">
              {muted ? <MicOff className="h-4 w-4 text-red-600" /> : <Mic className="h-4 w-4 text-gray-600" />}
              {muted ? 'Mutado' : 'Mutar'}
            </button>
            <button type="button" onClick={() => setShowTransfer(!showTransfer)} disabled={state.state !== 'connected'} className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md disabled:opacity-50">
              <ArrowRightLeft className="h-4 w-4" /> Transferir
            </button>
          </div>
          {showTransfer && (
            <div className="flex gap-1 pt-1 border-t">
              <input
                type="text"
                value={transferTarget}
                onChange={e => setTransferTarget(e.target.value)}
                placeholder="Ramal (ex: 102)"
                className="flex-1 px-2 py-1.5 text-sm border rounded-md"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') doTransfer() }}
              />
              <button type="button" onClick={doTransfer} disabled={!transferTarget} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md disabled:opacity-50">OK</button>
            </div>
          )}
        </div>
      )}

      {error && !error.includes('nao tem ramal') && (
        <div className="fixed bottom-20 right-4 z-[9000] bg-red-50 border border-red-300 rounded-md p-2 max-w-sm text-xs text-red-700">
          ⚠ {error}
        </div>
      )}
    </>
  )
}
