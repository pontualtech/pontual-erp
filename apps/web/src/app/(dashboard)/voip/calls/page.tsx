'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, PlayCircle, RefreshCw, Loader2 } from 'lucide-react'

interface Call {
  id: string
  call_id: string
  direction: string
  from_number: string
  to_number: string
  status: string
  started_at: string
  duration_sec: number | null
  recording_url: string | null
  agent_extension: string | null
  customers?: { id: string; legal_name: string; trade_name: string | null; mobile: string | null; phone: string | null } | null
  user_profiles?: { id: string; name: string; email: string } | null
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(s: number | null) {
  if (!s) return '—'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    answered: { color: 'bg-green-100 text-green-700', label: 'Atendida' },
    completed: { color: 'bg-green-100 text-green-700', label: 'Atendida' },
    ringing: { color: 'bg-amber-100 text-amber-700', label: 'Tocando' },
    missed: { color: 'bg-red-100 text-red-700', label: 'Perdida' },
    busy: { color: 'bg-orange-100 text-orange-700', label: 'Ocupado' },
    no_answer: { color: 'bg-red-100 text-red-700', label: 'Não atendida' },
    failed: { color: 'bg-red-100 text-red-700', label: 'Falhou' },
  }
  const m = map[status] || { color: 'bg-gray-100 text-gray-700', label: status }
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.color}`}>{m.label}</span>
}

function DirectionIcon({ direction, status }: { direction: string; status: string }) {
  if (status === 'missed' || status === 'no_answer') return <PhoneMissed className="h-4 w-4 text-red-500" />
  if (direction === 'inbound') return <PhoneIncoming className="h-4 w-4 text-green-600" />
  return <PhoneOutgoing className="h-4 w-4 text-blue-600" />
}

export default function VoipCallsPage() {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState<'' | 'inbound' | 'outbound'>('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  function load() {
    setLoading(true)
    setError('')
    const url = new URL('/api/voip/calls', window.location.origin)
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', '20')
    if (direction) url.searchParams.set('direction', direction)
    if (status) url.searchParams.set('status', status)
    if (search) url.searchParams.set('search', search)

    fetch(url.toString())
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(typeof d.error === 'string' ? d.error : (d.error?.message || 'Erro')); return }
        setCalls(d.data ?? [])
        setTotal(d.pagination?.total ?? 0)
      })
      .catch(() => setError('Erro ao carregar chamadas'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, direction, status])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Phone className="h-6 w-6 text-blue-600" />
          Chamadas (VoIP)
        </h1>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      <div className="rounded-lg border bg-white p-4 grid sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buscar</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setPage(1); load() } }}
            placeholder="número ou nome..."
            className="w-full px-3 py-1.5 text-sm border rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Direção</label>
          <select value={direction} onChange={e => { setDirection(e.target.value as any); setPage(1) }} className="w-full px-3 py-1.5 text-sm border rounded-md">
            <option value="">Todas</option>
            <option value="inbound">Recebidas</option>
            <option value="outbound">Realizadas</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className="w-full px-3 py-1.5 text-sm border rounded-md">
            <option value="">Todos</option>
            <option value="answered">Atendida</option>
            <option value="completed">Concluída</option>
            <option value="missed">Perdida</option>
            <option value="busy">Ocupado</option>
            <option value="failed">Falha</option>
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={() => { setPage(1); load() }} className="w-full px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md">
            Filtrar
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        {loading && (
          <div className="py-12 text-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin inline-block" />
            <p className="mt-2 text-sm">Carregando...</p>
          </div>
        )}
        {error && <div className="p-6 text-center text-red-600">{error}</div>}
        {!loading && !error && calls.length === 0 && (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Nenhuma chamada encontrada</p>
          </div>
        )}
        {!loading && !error && calls.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">De</th>
                  <th className="px-4 py-3">Para</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Atendente</th>
                  <th className="px-4 py-3">Duração</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Gravação</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {calls.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <DirectionIcon direction={c.direction} status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(c.started_at)}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{c.from_number || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{c.to_number || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {c.customers ? (
                        <Link href={`/clientes/${c.customers.id}`} className="text-blue-600 hover:underline">
                          {c.customers.legal_name}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.user_profiles?.name || c.agent_extension || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDuration(c.duration_sec)}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-center">
                      {c.recording_url ? <PlayCircle className="h-5 w-5 text-blue-600 inline" /> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/voip/calls/${c.id}`} className="text-xs text-blue-600 hover:underline">Detalhes</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 20 && (
          <div className="border-t px-4 py-3 flex items-center justify-between text-sm">
            <span className="text-gray-500">Total: {total} chamadas</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 border rounded disabled:opacity-50">← Anterior</button>
              <span className="px-3 py-1">Página {page}</span>
              <button disabled={calls.length < 20} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-50">Próxima →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
