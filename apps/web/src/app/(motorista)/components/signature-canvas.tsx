'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Canvas-based signature pad. Works on touch + mouse. No external lib.
 * Exposes:
 *  - onChange(dataUrl | null) every time the user commits a stroke (pointerup)
 *  - clear() via ref, to reset externally if needed
 *
 * Why a canvas and not a lib: adds zero bytes to the bundle, has first-class
 * touch support via Pointer Events, and we already know the exact shape we
 * want (fixed height, white bg, dismiss button). Libs bring their own CSS
 * that fights our mobile layout.
 */
export default function SignatureCanvas({
  onChange,
  height = 200,
  disabled = false,
}: {
  onChange: (dataUrl: string | null) => void
  height?: number
  disabled?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)

  // Resize canvas bitmap to device pixel ratio — avoids blurry lines.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2937'
    // background white so PNG export doesn't have transparent areas
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
  }, [])

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.preventDefault()
    canvasRef.current!.setPointerCapture(e.pointerId)
    drawingRef.current = true
    lastRef.current = getPoint(e)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = getPoint(e)
    const last = lastRef.current!
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastRef.current = p
    if (!hasInk) setHasInk(true)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    drawingRef.current = false
    canvasRef.current!.releasePointerCapture(e.pointerId)
    // Emit the current PNG on every stroke-end so parent always has fresh data.
    onChange(canvasRef.current!.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ height, width: '100%', touchAction: 'none' }}
        className="border border-gray-300 rounded-lg bg-white"
        aria-label="Área de assinatura"
      />
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{hasInk ? 'Assinado' : 'Assine no quadro acima'}</span>
        <button type="button" onClick={clear} disabled={!hasInk || disabled}
          className="text-red-600 disabled:text-gray-300 font-medium">
          Limpar
        </button>
      </div>
    </div>
  )
}
