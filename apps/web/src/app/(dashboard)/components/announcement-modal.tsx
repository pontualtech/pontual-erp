'use client'

import { useState } from 'react'
import { AlertTriangle, Info, Bell, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAvisos } from '@/lib/use-avisos'

interface RequiredAnnouncement {
  id: string
  title: string
  message: string
  priority: string
  author_name: string | null
  created_at: string
}

const priorityConfig: Record<string, { style: string; icon: typeof Info }> = {
  INFO: { style: 'bg-gray-100 text-gray-700', icon: Info },
  NORMAL: { style: 'bg-blue-100 text-blue-700', icon: Bell },
  IMPORTANTE: { style: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  URGENTE: { style: 'bg-red-100 text-red-700', icon: ShieldAlert },
}

function getPriority(p: string) {
  return priorityConfig[p] || priorityConfig.INFO
}

export function AnnouncementModal() {
  const { requiredAnnouncements: announcements, removeAnnouncement } = useAvisos()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [confirming, setConfirming] = useState(false)

  const handleConfirm = async () => {
    const current = announcements[currentIndex]
    if (!current) return

    setConfirming(true)
    try {
      await fetch(`/api/avisos/${current.id}/read`, { method: 'POST' })
      removeAnnouncement(current.id)

      if (currentIndex >= announcements.length - 1) {
        setCurrentIndex(0)
      }
    } catch {}
    setConfirming(false)
  }

  if (announcements.length === 0) return null

  const current = announcements[currentIndex]
  const { style, icon: PriorityIcon } = getPriority(current.priority)

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            <h2 className="text-base font-semibold text-gray-900">Aviso Importante</h2>
          </div>
          {announcements.length > 1 && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              {currentIndex + 1} de {announcements.length}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                style
              )}
            >
              <PriorityIcon className="h-3 w-3" />
              {current.priority}
            </span>
          </div>

          <h3 className="text-lg font-bold text-gray-900 mb-3">{current.title}</h3>

          <div className="max-h-60 overflow-y-auto rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {current.message}
            </p>
          </div>

          <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
            {current.author_name && <span>Por {current.author_name}</span>}
            <span>{formatDate(current.created_at)}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4">
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className={cn(
              'w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors',
              confirming
                ? 'bg-blue-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
            )}
          >
            {confirming ? 'Confirmando...' : 'Li e entendi'}
          </button>
        </div>
      </div>
    </div>
  )
}
