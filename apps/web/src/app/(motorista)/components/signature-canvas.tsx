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
  // UX-9 #13: anti-fraude — count de pontos + duração total + bounding box.
  // Assinatura "rabisco" (1 traço de 0.3s) é evidência fraca em disputa.
  // Mínimos: 30 pontos OU duração > 800ms OU bbox >= 40×20px.
  const pointsCountRef = useRef(0)
  const startTimeRef = useRef<number | null>(null)
  const bboxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null)
  const [valid, setValid] = useState(false)

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
    if (startTimeRef.current == null) startTimeRef.current = Date.now()
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
    // UX-9 #13: tracking pra anti-fraude
    pointsCountRef.current += 1
    if (!bboxRef.current) bboxRef.current = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
    else {
      const b = bboxRef.current
      if (p.x < b.minX) b.minX = p.x
      if (p.y < b.minY) b.minY = p.y
      if (p.x > b.maxX) b.maxX = p.x
      if (p.y > b.maxY) b.maxY = p.y
    }
  }

  function isSignatureValid(): boolean {
    const points = pointsCountRef.current
    const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 0
    const bbox = bboxRef.current
    const bboxW = bbox ? bbox.maxX - bbox.minX : 0
    const bboxH = bbox ? bbox.maxY - bbox.minY : 0
    // Aceita se pelo menos 1 dos 3 critérios bate (motorista rápido OK, mas
    // rabisco trivial 1-ponto fica fora):
    return points >= 30 || elapsed >= 800 || (bboxW >= 40 && bboxH >= 20)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    drawingRef.current = false
    canvasRef.current!.releasePointerCapture(e.pointerId)
    const validNow = isSignatureValid()
    setValid(validNow)
    // Só emite PNG válida — anti-fraude impede rabisco trivial passar
    onChange(validNow ? canvasRef.current!.toDataURL('image/png') : null)
  }

  function clear() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    setValid(false)
    pointsCountRef.current = 0
    startTimeRef.current = null
    bboxRef.current = null
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
      <div className="flex items-center justify-between text-xs">
        <span className={hasInk ? (valid ? 'text-emerald-600 font-semibold' : 'text-amber-600') : 'text-gray-500'}>
          {!hasInk ? 'Assine no quadro acima' : valid ? '✓ Assinatura válida' : '⚠ Continue assinando…'}
        </span>
        <button type="button" onClick={clear} disabled={!hasInk || disabled}
          className="text-red-600 disabled:text-gray-300 font-medium">
          Limpar
        </button>
      </div>
    </div>
  )
}
