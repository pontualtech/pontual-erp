'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, Trash2, Users, FileText, Search, ChevronRight, Sparkles, Send } from 'lucide-react'
import { StatCard } from '@/components/marketing/StatCard'
import { EmptyState } from '@/components/marketing/EmptyState'
import { TagList } from '@/components/marketing/TagBadge'
import { formatRelative, formatDateAbsolute, formatNumber } from '@/lib/marketing/format'
import { humanizeTag } from '@/lib/marketing/tags'
import { getStage } from '@/lib/marketing/stages'

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

/** Converte filters JSON em chips humanizados */
function filterChips(filters: any): { label: string; tone?: 'blue' | 'purple' | 'amber' | 'gray' }[] {
  if (!filters) return []
  const chips: { label: string; tone?: 'blue' | 'purple' | 'amber' | 'gray' }[] = []
  if (filters.search) chips.push({ label: `🔍 "${filters.search}"`, tone: 'blue' })
  if (filters.segment) {
    const seg = humanizeTag(`segment:${filters.segment}`)
    chips.push({ label: seg.emoji ? `${seg.emoji} ${seg.label}` : seg.label, tone: 'purple' })
  }
  if (filters.stage) {
    const stage = getStage(filters.stage)
    if (stage) chips.push({ label: `${stage.emoji} ${stage.label}`, tone: 'blue' })
  }
  if (filters.unsubscribed === 'true') chips.push({ label: '🚫 Só descadastrados', tone: 'amber' })
  if (filters.unsubscribed === 'false') chips.push({ label: '✓ Só inscritos', tone: 'gray' })
  if (filters.onlyBounced) chips.push({ label: '⚠️ Com bounce', tone: 'amber' })
  if (Array.isArray(filters.tags) && filters.tags.length > 0) {
    filters.tags.forEach((t: string) => chips.push({ label: humanizeTag(t).label, tone: 'gray' }))
  }
  if (chips.length === 0) chips.push({ label: 'Todos os contatos', tone: 'gray' })
  return chips
}

function chipColor(tone?: string) {
  switch (tone) {
    case 'blue':   return 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300'
    case 'purple': return 'bg-purple-50 text-purple-700 ring-1 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-300'
    case 'amber':  return 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300'
    default:       return 'bg-gray-100 text-gray-700 ring-1 ring-gray-500/20 dark:bg-gray-700/40 dark:text-gray-300'
  }
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
    if (!confirm(`Apagar segmento "${name}"?\n\nEssa ação não pode ser desfeita. Os contatos NÃO serão apagados — só o filtro salvo.`)) return
    setDeletingId(id)
    try {
      const r = await fetch(`/api/marketing/segmentos/${id}`, { method: 'DELETE' })
      if (r.ok) setSegments(s => s.filter(x => x.id !== id))
      else alert('Erro ao apagar segmento.')
    } finally {
      setDeletingId(null)
    }
  }

  // Stats agregadas (pra cards do topo)
  const totalContacts = segments.reduce((s, x) => s + (x.contact_count || 0), 0)
  const lastUpdated = segments.length > 0
    ? segments.reduce((latest, x) => new Date(x.updated_at) > new Date(latest) ? x.updated_at : latest, segments[0].updated_at)
    : null

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-2.5 text-white shadow-sm">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Segmentos
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Filtros salvos como listas reutilizáveis — compartilhados pela empresa
            </p>
          </div>
        </div>
        <Link
          href="/marketing/contatos"
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Criar segmento
        </Link>
      </div>

      {/* Stats agregadas */}
      {!loading && segments.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Segmentos salvos" value={segments.length} icon={FileText} tone="default" />
          <StatCard
            label="Contatos cobertos"
            value={totalContacts}
            hint="soma de todos os segmentos (pode contar mesmo contato 2x)"
            icon={Users}
            tone="blue"
          />
          <StatCard
            label="Maior segmento"
            value={formatNumber(Math.max(...segments.map(s => s.contact_count || 0)))}
            hint={segments.find(s => s.contact_count === Math.max(...segments.map(x => x.contact_count || 0)))?.name?.slice(0, 30)}
            icon={Sparkles}
            tone="green"
          />
          <StatCard
            label="Última atualização"
            value={lastUpdated ? formatRelative(lastUpdated) : '—'}
            icon={FileText}
            tone="gray"
          />
        </div>
      )}

      {/* Help banner */}
      {!loading && (
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-500/10 dark:text-blue-300">
          <strong>Como criar:</strong> abra <Link href="/marketing/contatos" className="underline">Contatos</Link>, configure os filtros que quer (busca, segmento, fase, etc),
          e clique em <strong>"Salvar como segmento"</strong> no canto direito. Volta aqui pra ver, abrir ou apagar.
        </div>
      )}

      {/* Grid de segmentos ou empty */}
      {loading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : segments.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum segmento salvo ainda"
          description="Salve filtros da página de Contatos pra reusar quando quiser disparar campanhas pra um grupo específico."
          action={{ label: 'Ir para Contatos', href: '/marketing/contatos' }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {segments.map(s => (
            <div
              key={s.id}
              className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-emerald-500/40"
            >
              {/* Ações no canto: enviar + deletar */}
              <div className="absolute right-2 top-2 flex gap-1">
                <Link
                  href={`/marketing/segmentos/${s.id}/enviar`}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-md p-1.5 text-gray-400 opacity-0 transition hover:bg-purple-50 hover:text-purple-600 group-hover:opacity-100 dark:hover:bg-purple-900/30"
                  aria-label={`Enviar campanha para segmento ${s.name}`}
                  title="Enviar campanha"
                >
                  <Send className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); handleDelete(s.id, s.name) }}
                  disabled={deletingId === s.id}
                  className="rounded-md p-1.5 text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50 dark:hover:bg-red-900/30"
                  aria-label={`Apagar segmento ${s.name}`}
                  title="Apagar segmento"
                >
                  {deletingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>

              <Link href={`/marketing/segmentos/${s.id}`} className="flex flex-1 flex-col">
                {/* Header do card */}
                <div className="mb-3 flex items-start gap-2.5">
                  <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-500/10">
                    <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0 flex-1 pr-6">
                    <h3 className="truncate font-semibold text-gray-900 group-hover:text-emerald-700 dark:text-gray-100 dark:group-hover:text-emerald-300">
                      {s.name}
                    </h3>
                    {s.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{s.description}</p>
                    )}
                  </div>
                </div>

                {/* Total grande */}
                <div className="mb-3">
                  <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                    {s.contact_count !== null ? formatNumber(s.contact_count) : '—'}
                    <span className="ml-1 text-xs font-normal text-gray-500">contatos</span>
                  </div>
                  {s.contact_count_updated_at && (
                    <div className="text-[10px] text-gray-400" title={formatDateAbsolute(s.contact_count_updated_at)}>
                      atualizado {formatRelative(s.contact_count_updated_at)}
                    </div>
                  )}
                </div>

                {/* Filter chips */}
                <div className="mb-3 flex flex-wrap gap-1">
                  {filterChips(s.filters).slice(0, 4).map((c, i) => (
                    <span key={i} className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${chipColor(c.tone)}`}>
                      {c.label}
                    </span>
                  ))}
                  {filterChips(s.filters).length > 4 && (
                    <span className="text-[10px] text-gray-400">+{filterChips(s.filters).length - 4}</span>
                  )}
                </div>

                {/* Footer */}
                <div className="mt-auto flex items-center justify-between border-t border-gray-100 pt-2 text-xs dark:border-gray-700">
                  <span className="text-gray-400" title={formatDateAbsolute(s.created_at)}>
                    Criado {formatRelative(s.created_at)}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-emerald-600 opacity-0 transition group-hover:opacity-100 dark:text-emerald-400">
                    Abrir <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
