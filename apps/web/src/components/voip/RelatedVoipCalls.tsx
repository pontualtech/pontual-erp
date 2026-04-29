'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react'

interface VoipCallRow {
  id: string
  direction: string
  from_number: string
  to_number: string
  status: string
  started_at: string
  duration_sec: number | null
  recording_url: string | null
  user_profiles?: { id: string; name: string } | null
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(s: number | null) {
  if (!s) return '—'
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function statusLabel(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    answered: { label: 'Atendida', color: 'text-green-700' },
    completed: { label: 'Concluída', color: 'text-green-700' },
    missed: { label: 'Perdida', color: 'text-red-700' },
    no_answer: { label: 'Não atendida', color: 'text-red-700' },
    busy: { label: 'Ocupado', color: 'text-orange-700' },
    failed: { label: 'Falha', color: 'text-red-700' },
    ringing: { label: 'Tocando', color: 'text-amber-700' },
  }
  return map[status] || { label: status, color: 'text-gray-700' }
}

interface Props {
  osId: string
}

export function RelatedVoipCalls({ osId }: Props) {
  const [calls, setCalls] = useState<VoipCallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/voip/calls?serviceOrderId=${osId}&limit=50`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(typeof d.error === 'string' ? d.error : 'Erro'); return }
        setCalls(d.data ?? [])
      })
      .catch(() => setError('Erro ao listar chamadas'))
      .finally(() => setLoading(false))
  }, [osId])

  if (loading) return <div className="text-sm text-gray-400 py-3">Carregando chamadas…</div>
  if (error) return <div className="text-sm text-red-600 py-3">{error}</div>
  if (calls.length === 0) {
    return (
      <div className="text-sm text-gray-400 italic py-3">
        Nenhuma chamada vinculada a esta OS.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-gray-500">
            <th className="px-2 py-2 w-6"></th>
            <th className="px-2 py-2">Quando</th>
            <th className="px-2 py-2">Número</th>
            <th className="px-2 py-2">Atendente</th>
            <th className="px-2 py-2">Duração</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {calls.map(c => {
            const Icon = c.status === 'missed' || c.status === 'no_answer'
              ? PhoneMissed
              : c.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing
            const s = statusLabel(c.status)
            const phone = c.direction === 'inbound' ? c.from_number : c.to_number
            return (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-2 py-2">
                  <Icon className="h-4 w-4 text-gray-500" />
                </td>
                <td className="px-2 py-2 text-gray-700">{formatDateTime(c.started_at)}</td>
                <td className="px-2 py-2 font-mono text-xs text-gray-700">{phone || '—'}</td>
                <td className="px-2 py-2 text-gray-700">{c.user_profiles?.name || '—'}</td>
                <td className="px-2 py-2 text-gray-700">{formatDuration(c.duration_sec)}</td>
                <td className={`px-2 py-2 font-medium ${s.color}`}>{s.label}</td>
                <td className="px-2 py-2">
                  <Link href={`/voip/calls/${c.id}`} className="text-xs text-blue-600 hover:underline">
                    Detalhes {c.recording_url ? '🎵' : ''}
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
