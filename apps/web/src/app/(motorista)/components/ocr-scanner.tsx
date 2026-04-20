'use client'

import { useState } from 'react'
import CameraCapture from './camera-capture'
import { toast } from 'sonner'

/**
 * OCR scanner — wrapper around CameraCapture that POSTs the image to the
 * server's OCR endpoint (which in turn calls Google Vision API or runs
 * tesseract locally). Returns the best-guess serial number.
 *
 * Fail-open: if OCR endpoint fails, we still pass the photo back so the
 * driver can type the serial manually from the photo.
 */
export default function OcrScanner({
  onResult,
  onCancel,
}: {
  onResult: (args: { serial: string | null; photoBase64: string; source: 'ocr' | 'manual' }) => void
  onCancel: () => void
}) {
  const [processing, setProcessing] = useState(false)

  async function handleCapture(photoBase64: string) {
    setProcessing(true)
    try {
      const res = await fetch('/api/driver/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: photoBase64 }),
      })
      if (!res.ok) {
        toast.warning('OCR falhou — você pode digitar o número manualmente')
        onResult({ serial: null, photoBase64, source: 'manual' })
        return
      }
      const { data } = await res.json()
      onResult({ serial: data.serial || null, photoBase64, source: data.serial ? 'ocr' : 'manual' })
    } catch {
      toast.warning('Sem rede — digite o número manualmente')
      onResult({ serial: null, photoBase64, source: 'manual' })
    } finally { setProcessing(false) }
  }

  if (processing) {
    return (
      <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center text-white">
        <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full" />
        <p className="mt-4 text-lg">Lendo etiqueta…</p>
      </div>
    )
  }

  return (
    <CameraCapture
      onCapture={handleCapture}
      onCancel={onCancel}
      maxLongEdge={1600}     // mais pixels = OCR melhor
      quality={0.85}
      hint="Aponte para a etiqueta do S/N"
    />
  )
}
