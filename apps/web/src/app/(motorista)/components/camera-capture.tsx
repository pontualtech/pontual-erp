'use client'

import { useEffect, useRef, useState } from 'react'
import { X, RefreshCw, Check } from 'lucide-react'

/**
 * Fullscreen camera capture for mobile. Uses getUserMedia (standard Web API).
 *
 * Produces a compressed JPEG data URL (base64) via canvas.toBlob() + FileReader.
 * Target: long-edge 1280px at 0.75 quality — typical comprovante fica ~150-300KB.
 *
 * Called from parent with `onCapture(jpegBase64)` / `onCancel()`.
 */
export default function CameraCapture({
  onCapture,
  onCancel,
  maxLongEdge = 1280,
  quality = 0.75,
  hint,
}: {
  onCapture: (jpegBase64: string) => void
  onCancel: () => void
  maxLongEdge?: number
  quality?: number
  hint?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Request back-facing camera. `environment` works on all modern mobile
  // browsers; desktop chrome without rear-cam will pick whatever is available.
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
    }).catch(err => {
      setError(err?.message || 'Falha ao abrir câmera')
    })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  function snap() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    // Scale down to maxLongEdge to keep file size reasonable.
    const longEdge = Math.max(video.videoWidth, video.videoHeight)
    const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    setPreview(dataUrl)
  }

  function retake() { setPreview(null) }
  function confirm() {
    if (!preview) return
    // Strip "data:image/jpeg;base64," prefix — server just needs the raw base64.
    onCapture(preview.replace(/^data:image\/jpeg;base64,/, ''))
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button onClick={onCancel} aria-label="Fechar" className="p-2">
          <X className="w-6 h-6" />
        </button>
        <p className="text-sm opacity-80 text-center flex-1">{hint || 'Enquadre e toque pra capturar'}</p>
        <div className="w-10" />
      </div>

      <div className="flex-1 relative overflow-hidden flex items-center justify-center">
        {error ? (
          <div className="p-6 text-white text-center">
            <p className="font-medium">Câmera indisponível</p>
            <p className="text-sm opacity-70 mt-1">{error}</p>
            <button onClick={onCancel} className="mt-4 bg-white/20 px-4 py-2 rounded">Voltar</button>
          </div>
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Pré-visualização" className="max-w-full max-h-full" />
        ) : (
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        )}
      </div>

      <div className="p-6 flex items-center justify-center gap-6 bg-black/80">
        {preview ? (
          <>
            <button onClick={retake} aria-label="Refazer"
              className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center">
              <RefreshCw className="w-7 h-7 text-white" />
            </button>
            <button onClick={confirm} aria-label="Confirmar"
              className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center active:scale-95 transition">
              <Check className="w-10 h-10 text-white" />
            </button>
          </>
        ) : (
          <button onClick={snap} disabled={!!error} aria-label="Capturar"
            className="w-20 h-20 rounded-full bg-white border-4 border-white/50 disabled:opacity-40 active:scale-95 transition" />
        )}
      </div>
    </div>
  )
}
