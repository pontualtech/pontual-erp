'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, Check, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useAvisos } from '@/lib/use-avisos'

interface Announcement {
  id: string
  title: string
  message: string
  priority: string
  author_name: string | null
  created_at: string
  ticket_id?: string | null
}

const priorityStyles: Record<string, string> = {
  INFO: 'bg-gray-100 text-gray-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  IMPORTANTE: 'bg-amber-100 text-amber-700',
  URGENTE: 'bg-red-100 text-red-700',
}

function getPriorityStyle(p: string) {
  return priorityStyles[p] || priorityStyles.INFO
}

export function NotificationBell() {
  const { bellAnnouncements: announcements, bellCount: count, removeAnnouncement } = useAvisos()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const markAsRead = async (id: string) => {
    try {
      await fetch(`/api/avisos/${id}/read`, { method: 'POST' })
      removeAnnouncement(id)
    } catch {}
  }

  // Click no card todo: se tiver ticket_id, vai pro ticket (atendente
  // responde direto). Sem ticket_id, vai pra pagina geral de avisos.
  // Marca como lido implicitamente — atendente que abriu ja viu.
  const openAviso = (a: Announcement) => {
    setOpen(false)
    markAsRead(a.id)
    if (a.ticket_id) {
      router.push(`/tickets/${a.ticket_id}`)
    } else {
      router.push('/avisos')
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-lg border bg-white shadow-xl sm:w-96">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Notificações</h3>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {announcements.length === 0 ? (
              <div className="p-6 text-center">
                <Bell className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-2 text-sm text-gray-400">Nenhuma notificação pendente</p>
              </div>
            ) : (
              announcements.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => openAviso(a)}
                  className="w-full text-left border-b px-4 py-3 last:border-b-0 hover:bg-gray-50 cursor-pointer"
                  title={a.ticket_id ? 'Abrir ticket pra responder o cliente' : 'Ver aviso'}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-medium',
                            getPriorityStyle(a.priority)
                          )}
                        >
                          {a.priority}
                        </span>
                        <span className="text-xs text-gray-400">{formatDate(a.created_at)}</span>
                        {a.ticket_id && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            Responder
                          </span>
                        )}
                      </div>
                      <h4 className="mt-1 text-sm font-medium text-gray-900 truncate">{a.title}</h4>
                      <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{a.message}</p>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); markAsRead(a.id) }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); markAsRead(a.id) } }}
                      className="flex-shrink-0 rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                      title="Marcar como lido sem abrir"
                    >
                      <Check className="h-4 w-4" />
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t px-4 py-2">
            <Link
              href="/avisos"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Ver todos os avisos
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
