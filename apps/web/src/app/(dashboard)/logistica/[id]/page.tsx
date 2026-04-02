'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Loader2, Play, CheckCircle2, XCircle, MapPin,
  Clock, Package, Truck as TruckIcon, Camera, FileSignature,
  AlertTriangle, Image, Map, Eye,
} from 'lucide-react'
import { toast } from 'sonner'

/* ---------- Interfaces ---------- */

interface StopPhoto {
  id: string
  url: string
  thumbnail_url?: string
}

interface RouteStop {
  id: string
  sequence: number
  type: 'COLETA' | 'ENTREGA'
  status: 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'FAILED'
  customer_name: string
  address: string
  os_id: string | null
  os_number: number | null
  time_window_start: string | null
  time_window_end: string | null
  arrived_at: string | null
  completed_at: string | null
  failure_reason: string | null
  photos: StopPhoto[]
  signature_url: string | null
}

interface RouteDetail {
  id: string
  date: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'
  driver_name: string
  started_at: string | null
  completed_at: string | null
  stops: RouteStop[]
}

/* ---------- Helpers ---------- */

function formatTime(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(dt: string) {
  return new Date(dt + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const routeStatusConfig: Record<string, { label: string; bg: string; text: string }> = {
  PLANNED: { label: 'Planejada', bg: 'bg-blue-100', text: 'text-blue-700' },
  IN_PROGRESS: { label: 'Em Andamento', bg: 'bg-amber-100', text: 'text-amber-700' },
  COMPLETED: { label: 'Concluida', bg: 'bg-green-100', text: 'text-green-700' },
}

const stopStatusConfig: Record<string, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  PENDING: { label: 'Pendente', bg: 'bg-gray-100', text: 'text-gray-500', icon: Clock },
  ARRIVED: { label: 'Chegou', bg: 'bg-amber-100', text: 'text-amber-700', icon: MapPin },
  COMPLETED: { label: 'Concluido', bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle2 },
  FAILED: { label: 'Falha', bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
}

const stopTypeConfig = {
  COLETA: { label: 'Coleta', bg: 'bg-orange-100', text: 'text-orange-700', icon: Package },
  ENTREGA: { label: 'Entrega', bg: 'bg-green-100', text: 'text-green-700', icon: TruckIcon },
}

/* ---------- Component ---------- */

export default function RouteDetailPage() {
  const params = useParams()
  const routeId = params.id as string

  const [route, setRoute] = useState<RouteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Failure modal
  const [failureModal, setFailureModal] = useState<{ stopId: string } | null>(null)
  const [failureReason, setFailureReason] = useState('')

  // Photo upload
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null)

  const loadRoute = useCallback(async () => {
    try {
      const res = await fetch(`/api/logistics/routes/${routeId}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRoute(data.data)
      setError(false)
    } catch {
      setError(true)
      toast.error('Erro ao carregar rota')
    } finally {
      setLoading(false)
    }
  }, [routeId])

  useEffect(() => { loadRoute() }, [loadRoute])

  // ESC closes failure modal
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) { if (e.key === 'Escape') setFailureModal(null) }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [])

  const handleStartRoute = async () => {
    setActionLoading('route-start')
    try {
      const res = await fetch(`/api/logistics/routes/${routeId}/start`, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success('Rota iniciada')
      loadRoute()
    } catch {
      toast.error('Erro ao iniciar rota')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCompleteRoute = async () => {
    setActionLoading('route-complete')
    try {
      const res = await fetch(`/api/logistics/routes/${routeId}/complete`, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success('Rota concluida')
      loadRoute()
    } catch {
      toast.error('Erro ao concluir rota')
    } finally {
      setActionLoading(null)
    }
  }

  const handleStopAction = async (stopId: string, action: 'arrive' | 'complete' | 'fail', body?: Record<string, any>) => {
    setActionLoading(stopId)
    try {
      const res = await fetch(`/api/logistics/routes/${routeId}/stops/${stopId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error()
      const labels = { arrive: 'Chegada registrada', complete: 'Parada concluida', fail: 'Falha registrada' }
      toast.success(labels[action])
      loadRoute()
      if (action === 'fail') setFailureModal(null)
    } catch {
      toast.error('Erro ao atualizar parada')
    } finally {
      setActionLoading(null)
    }
  }

  const handlePhotoUpload = async (stopId: string, files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadingPhoto(stopId)
    try {
      const formData = new FormData()
      Array.from(files).forEach(f => formData.append('photos', f))

      const res = await fetch(`/api/logistics/routes/${routeId}/stops/${stopId}/photos`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error()
      toast.success('Foto enviada')
      loadRoute()
    } catch {
      toast.error('Erro ao enviar foto')
    } finally {
      setUploadingPhoto(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-300" />
      </div>
    )
  }

  if (error || !route) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/logistica" className="rounded-lg border p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Rota</h1>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border bg-white p-12 shadow-sm text-center">
          <AlertTriangle className="h-10 w-10 text-red-300 mb-3" />
          <p className="text-sm text-gray-500">Erro ao carregar a rota ou rota nao encontrada</p>
          <Link href="/logistica" className="mt-4 text-sm text-blue-600 hover:underline">
            Voltar para logistica
          </Link>
        </div>
      </div>
    )
  }

  const totalStops = route.stops.length
  const completedStops = route.stops.filter(s => s.status === 'COMPLETED').length
  const progress = totalStops > 0 ? Math.round((completedStops / totalStops) * 100) : 0
  const rst = routeStatusConfig[route.status] ?? routeStatusConfig.PLANNED

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/logistica" className="rounded-lg border p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Detalhes da Rota</h1>
      </div>

      {/* Route Info Card */}
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-lg font-bold text-blue-700">
              {route.driver_name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-semibold text-gray-900">{route.driver_name}</span>
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', rst.bg, rst.text)}>
                  {rst.label}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-4 text-sm text-gray-500">
                <span>{formatDate(route.date)}</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatTime(route.started_at)} — {formatTime(route.completed_at)}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {completedStops}/{totalStops} paradas
                </span>
              </div>
            </div>
          </div>

          {/* Route Actions */}
          <div className="flex items-center gap-2">
            {route.status === 'PLANNED' && (
              <button
                type="button"
                disabled={actionLoading === 'route-start'}
                onClick={handleStartRoute}
                className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'route-start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Iniciar Rota
              </button>
            )}
            {route.status === 'IN_PROGRESS' && (
              <button
                type="button"
                disabled={actionLoading === 'route-complete'}
                onClick={handleCompleteRoute}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'route-complete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Concluir Rota
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>Progresso</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100">
            <div
              className={cn(
                'h-2 rounded-full transition-all',
                route.status === 'COMPLETED' ? 'bg-green-500' : 'bg-blue-500'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Map Placeholder */}
      <div className="rounded-xl border bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center justify-center text-center">
          <Map className="h-10 w-10 text-gray-200 mb-2" />
          <p className="text-sm text-gray-400">Mapa em desenvolvimento</p>
        </div>
      </div>

      {/* Stops Timeline */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">Paradas</h2>
        </div>

        {route.stops.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <MapPin className="h-8 w-8 text-gray-200 mb-2" />
            <p className="text-sm text-gray-400">Nenhuma parada nesta rota</p>
          </div>
        ) : (
          <div className="relative px-5 py-4">
            {/* Timeline line */}
            <div className="absolute left-[2.15rem] top-4 bottom-4 w-0.5 bg-gray-200" />

            <div className="space-y-6">
              {route.stops
                .sort((a, b) => a.sequence - b.sequence)
                .map((stop, index) => {
                  const stConfig = stopStatusConfig[stop.status] ?? stopStatusConfig.PENDING
                  const StopStatusIcon = stConfig.icon
                  const typeConfig = stopTypeConfig[stop.type] ?? stopTypeConfig.COLETA
                  const TypeIcon = typeConfig.icon
                  const isActive = route.status === 'IN_PROGRESS'
                  const isLoadingStop = actionLoading === stop.id

                  return (
                    <div key={stop.id} className="relative flex gap-4 pl-4">
                      {/* Timeline dot */}
                      <div className={cn(
                        'absolute left-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white z-10',
                        stop.status === 'COMPLETED' ? 'bg-green-500 text-white' :
                        stop.status === 'ARRIVED' ? 'bg-amber-400 text-white' :
                        stop.status === 'FAILED' ? 'bg-red-500 text-white' :
                        'bg-gray-200 text-gray-500'
                      )}>
                        <span className="text-xs font-bold">{stop.sequence}</span>
                      </div>

                      {/* Stop Content */}
                      <div className="flex-1 ml-6 rounded-lg border bg-gray-50 p-4">
                        {/* Header row */}
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', typeConfig.bg, typeConfig.text)}>
                            <TypeIcon className="h-3 w-3" />
                            {typeConfig.label}
                          </span>
                          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', stConfig.bg, stConfig.text)}>
                            <StopStatusIcon className="h-3 w-3" />
                            {stConfig.label}
                          </span>
                          {stop.os_id && stop.os_number && (
                            <Link
                              href={`/os/${stop.os_id}`}
                              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-100 transition-colors"
                            >
                              <Eye className="h-3 w-3" />
                              OS-{String(stop.os_number).padStart(4, '0')}
                            </Link>
                          )}
                        </div>

                        {/* Customer + Address */}
                        <p className="text-sm font-medium text-gray-900">{stop.customer_name}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {stop.address}
                        </p>

                        {/* Time window */}
                        {(stop.time_window_start || stop.time_window_end) && (
                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                            <Clock className="h-3 w-3 shrink-0" />
                            Janela: {stop.time_window_start || '—'} — {stop.time_window_end || '—'}
                          </p>
                        )}

                        {/* Arrived / Completed times */}
                        {stop.arrived_at && (
                          <p className="text-xs text-amber-600 mt-1">Chegou as {formatTime(stop.arrived_at)}</p>
                        )}
                        {stop.completed_at && (
                          <p className="text-xs text-green-600 mt-0.5">Concluido as {formatTime(stop.completed_at)}</p>
                        )}

                        {/* Failure reason */}
                        {stop.status === 'FAILED' && stop.failure_reason && (
                          <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                            <span className="font-medium">Motivo:</span> {stop.failure_reason}
                          </div>
                        )}

                        {/* Photos */}
                        {stop.photos && stop.photos.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {stop.photos.map(photo => (
                              <a
                                key={photo.id}
                                href={photo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block h-16 w-16 overflow-hidden rounded-lg border hover:opacity-80 transition-opacity"
                              >
                                <img
                                  src={photo.thumbnail_url ?? photo.url}
                                  alt="Foto da parada"
                                  className="h-full w-full object-cover"
                                />
                              </a>
                            ))}
                          </div>
                        )}

                        {/* Signature */}
                        {stop.signature_url && (
                          <div className="mt-2 flex items-center gap-2">
                            <FileSignature className="h-3.5 w-3.5 text-gray-400" />
                            <a
                              href={stop.signature_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Ver assinatura
                            </a>
                          </div>
                        )}

                        {/* Actions */}
                        {isActive && stop.status !== 'COMPLETED' && stop.status !== 'FAILED' && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200">
                            {stop.status === 'PENDING' && (
                              <button
                                type="button"
                                disabled={isLoadingStop}
                                onClick={() => handleStopAction(stop.id, 'arrive')}
                                className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                              >
                                {isLoadingStop ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />}
                                Registrar Chegada
                              </button>
                            )}
                            {stop.status === 'ARRIVED' && (
                              <button
                                type="button"
                                disabled={isLoadingStop}
                                onClick={() => handleStopAction(stop.id, 'complete')}
                                className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                              >
                                {isLoadingStop ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                Concluir
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isLoadingStop}
                              onClick={() => { setFailureModal({ stopId: stop.id }); setFailureReason('') }}
                              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                            >
                              <XCircle className="h-3 w-3" />
                              Falha
                            </button>

                            {/* Photo upload */}
                            <label className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 cursor-pointer transition-colors">
                              {uploadingPhoto === stop.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Camera className="h-3 w-3" />
                              )}
                              Foto
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={e => handlePhotoUpload(stop.id, e.target.files)}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </div>

      {/* Failure Reason Modal */}
      {failureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setFailureModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                Registrar Falha
              </h3>
              <button type="button" title="Fechar" onClick={() => setFailureModal(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Motivo da falha</label>
                <textarea
                  value={failureReason}
                  onChange={e => setFailureReason(e.target.value)}
                  placeholder="Descreva o motivo..."
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={!failureReason.trim() || actionLoading === failureModal.stopId}
                  onClick={() => handleStopAction(failureModal.stopId, 'fail', { reason: failureReason })}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading === failureModal.stopId && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirmar Falha
                </button>
                <button
                  type="button"
                  onClick={() => setFailureModal(null)}
                  className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
