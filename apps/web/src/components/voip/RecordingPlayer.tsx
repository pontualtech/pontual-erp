'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Download } from 'lucide-react'

export interface RecordingPlayerProps {
  callId: string
  /** Duração em segundos (opcional, mostra timer total se vier) */
  durationSec?: number | null
  className?: string
}

/**
 * Player MP3 inline pra escutar gravação de chamada.
 * Stream via /api/voip/calls/{id}/recording (auth + multi-tenant).
 */
export function RecordingPlayer({ callId, durationSec, className = '' }: RecordingPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const src = `/api/voip/calls/${callId}/recording`

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setCurrentTime(audio.currentTime)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => setPlaying(false)
    const onLoadStart = () => setLoading(true)
    const onCanPlay = () => setLoading(false)
    const onError = () => { setLoading(false); setError('Falha ao carregar gravação') }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('loadstart', onLoadStart)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('loadstart', onLoadStart)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('error', onError)
    }
  }, [callId])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => setError('Erro ao reproduzir'))
    else audio.pause()
  }

  function fmt(s: number) {
    if (!s || isNaN(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  if (error) {
    return <div className={`text-sm text-red-600 ${className}`}>⚠️ {error}</div>
  }

  return (
    <div className={`flex items-center gap-2 p-2 rounded-md bg-gray-50 border ${className}`}>
      <button
        type="button"
        onClick={togglePlay}
        disabled={loading}
        className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
        title={playing ? 'Pausar' : 'Reproduzir'}
      >
        {loading ? '...' : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </button>
      <div className="text-xs text-gray-600 font-mono min-w-[80px]">
        {fmt(currentTime)} {durationSec ? `/ ${fmt(durationSec)}` : ''}
      </div>
      <a
        href={src}
        download={`call-${callId}.mp3`}
        className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600"
        title="Baixar MP3"
      >
        <Download className="h-3.5 w-3.5" />
      </a>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </div>
  )
}
