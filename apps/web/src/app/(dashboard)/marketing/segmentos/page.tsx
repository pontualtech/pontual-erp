'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Trash2, Users, ChevronRight, Pencil } from 'lucide-react'

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
  return new Date(s).toLocaleDateString('pt-BR')
}

function filterChips(filters: any): string[] {
  if (!filters) return []
  const chips: string[] = []
  if (filters.search) chips.push(`busca: "${filters.search}"`)
  if (filters.segment) chips.push(`segmento: ${filters.segment}`)
  if (filters.stage) chips.push(`fase: ${filters.stage}`)
  if (filters.unsubscribed === 'true') chips.push('só descadastrados')
  if (filters.unsubscribed === 'false') chips.push('só inscritos')
  if (filters.onlyBounced) chips.push('com bounce')
  if (Array.isArray(filters.tags) && filters.tags.length > 0) chips.push(`tags: ${filters.tags.join(', ')}`)
  if (chips.length === 0) chips.push('todos os contatos')
  return chips
}

export default function SegmentosPage() {
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function fetchSegments() {
    setLoading(true)
    try {
      const r = await fetch('/api/marketing/segmentos')
      if (r.ok) setSegments((await r.json()).data?.segments || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSegments() }, [])

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Apagar segmento "${name}"? Esta ação não pode ser desfeita.`)) return
    setDeletingId(id)
    try {
      const r = await fetch(`/api/marketing/segmentos/${id}`, { method: 'DELETE' })
      if (r.ok) {
        setSegments(s => s.filter(x => x.id !== id))
      } else {
        alert('Erro ao apagar segmento.')
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Marketing — Segmentos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Listas reutilizáveis de contatos filtrados. Compartilhadas pela empresa toda.
          </p>
        </div>
        <Link
          href="/marketing/contatos"
          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Criar segmento (via filtros)
        </Link>
      </div>

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
        <strong>Como criar:</strong> abre <Link href="/marketing/contatos" className="underline">Contatos</Link>, configura os filtros que quer (busca, segmento, fase, etc),
        e clica em <strong>"Salvar como segmento"</strong>. Aqui você gerencia os segmentos salvos.
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : segments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <Users className="mx-auto h-8 w-8 text-gray-400" />
          <h3 className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">Nenhum segmento salvo ainda</h3>
          <p className="mt-1 text-sm text-gray-500">Salve filtros da página de Contatos pra começar.</p>
          <Link
            href="/marketing/contatos"
            className="mt-4 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
          >
            Ir para Contatos
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Filtros</th>
                <th className="px-3 py-2 text-right">Contatos</th>
                <th className="px-3 py-2">Criado em</th>
                <th className="px-3 py-2"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {segments.map(s => (
                <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/40">
                  <td className="px-3 py-3">
                    <Link href={`/marketing/segmentos/${s.id}`} className="font-medium text-gray-900 hover:text-blue-600 dark:text-gray-100">
                      {s.name}
                    </Link>
                    {s.description && <div className="text-xs text-gray-500">{s.description}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {filterChips(s.filters).map((c, i) => (
                        <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">{c}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100">
                    {s.contact_count !== null ? s.contact_count.toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">{fmtDate(s.created_at)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/marketing/segmentos/${s.id}`}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        ver <ChevronRight className="h-3 w-3" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id, s.name)}
                        disabled={deletingId === s.id}
                        className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-50"
                        title="Apagar segmento"
                      >
                        {deletingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
