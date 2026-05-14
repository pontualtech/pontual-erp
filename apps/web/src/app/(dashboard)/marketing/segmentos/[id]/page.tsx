'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Users, Filter, ExternalLink, Trash2 } from 'lucide-react'

interface Segment {
  id: string
  name: string
  description: string | null
  filters: any
  contact_count: number | null
  contact_count_updated_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function buildContactsUrl(filters: any): string {
  const params = new URLSearchParams()
  if (filters?.search) params.set('search', filters.search)
  if (filters?.segment) params.set('segment', filters.segment)
  if (filters?.stage) params.set('stage', filters.stage)
  if (filters?.unsubscribed) params.set('unsubscribed', filters.unsubscribed)
  if (filters?.onlyBounced) params.set('onlyBounced', '1')
  return `/marketing/contatos?${params.toString()}`
}

export default function SegmentDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [segment, setSegment] = useState<Segment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const r = await fetch(`/api/marketing/segmentos/${params.id}`)
        if (r.ok) setSegment((await r.json()).data?.segment)
        else if (r.status === 404) setError('Segmento não encontrado')
        else setError('Erro ao carregar')
      } catch {
        setError('Erro de rede')
      } finally {
        setLoading(false)
      }
    }
    if (params.id) load()
  }, [params.id])

  async function handleDelete() {
    if (!segment) return
    if (!confirm(`Apagar segmento "${segment.name}"?`)) return
    setDeleting(true)
    const r = await fetch(`/api/marketing/segmentos/${segment.id}`, { method: 'DELETE' })
    if (r.ok) router.push('/marketing/segmentos')
    else {
      alert('Erro ao apagar.')
      setDeleting(false)
    }
  }

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>

  if (error || !segment) {
    return (
      <div className="p-6">
        <Link href="/marketing/segmentos" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <p className="mt-4 text-sm text-gray-500">{error || 'Sem dados'}</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <Link href="/marketing/segmentos" className="mb-4 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Voltar para segmentos
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{segment.name}</h1>
          {segment.description && <p className="text-sm text-gray-500 dark:text-gray-400">{segment.description}</p>}
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:hover:bg-red-900/20"
        >
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Apagar
        </button>
      </div>

      {/* Stats cards */}
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">Contatos atuais</div>
            <Users className="h-4 w-4 text-gray-400" />
          </div>
          <div className="mt-1 text-3xl font-semibold text-blue-600 dark:text-blue-400">
            {segment.contact_count !== null ? segment.contact_count.toLocaleString('pt-BR') : '—'}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Atualizado em {fmtDate(segment.contact_count_updated_at)}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="text-xs text-gray-500">Criado em</div>
          <div className="mt-1 text-base font-medium text-gray-900 dark:text-gray-100">{fmtDate(segment.created_at)}</div>
          {segment.created_by && <div className="mt-1 text-xs text-gray-500">por {segment.created_by.slice(0, 8)}…</div>}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="text-xs text-gray-500">Última atualização</div>
          <div className="mt-1 text-base font-medium text-gray-900 dark:text-gray-100">{fmtDate(segment.updated_at)}</div>
        </div>
      </div>

      {/* Filtros aplicados */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Filtros aplicados</h3>
        </div>
        <pre className="mt-3 overflow-x-auto rounded bg-gray-50 p-3 font-mono text-xs text-gray-700 dark:bg-gray-900 dark:text-gray-300">
{JSON.stringify(segment.filters, null, 2)}
        </pre>
      </div>

      {/* CTA: ver contatos deste segmento */}
      <div className="mt-6">
        <Link
          href={buildContactsUrl(segment.filters)}
          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Ver contatos deste segmento <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
