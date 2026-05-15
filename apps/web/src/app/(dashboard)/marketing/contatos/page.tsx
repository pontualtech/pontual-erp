'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  Search, Loader2, Users, MailX, MailWarning, Bookmark, ChevronRight,
  Mail, MousePointerClick, Inbox, Building2, User as UserIcon,
  LayoutGrid, List,
} from 'lucide-react'
import { TagList } from '@/components/marketing/TagBadge'
import { ContactAvatar } from '@/components/marketing/ContactAvatar'
import { StatCard } from '@/components/marketing/StatCard'
import { EmptyState } from '@/components/marketing/EmptyState'
import { KanbanBoard } from '@/components/marketing/KanbanBoard'
import { formatRelative, formatDateAbsolute } from '@/lib/marketing/format'
import { STAGES } from '@/lib/marketing/stages'

type ViewMode = 'table' | 'kanban'

interface Contact {
  id: string
  email: string
  name: string | null
  phone: string | null
  origin: string
  tags: string[]
  customer_id: string | null
  unsubscribed: boolean
  bounce_count: number
  last_sent_at: string | null
  last_opened_at: string | null
  last_clicked_at: string | null
  last_seen_at: string | null
  created_at: string | null
}

interface Stats {
  total: number
  unsubscribed: number
  bounced: number
  segments: { b2c: number; b2b: number }
  stages: { cliente_atendido: number; lead_aguardando: number; cliente_em_servico: number; perdido_recusou: number }
}

export default function MarketingContatosPage() {
  const urlParams = useSearchParams()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotalItems] = useState(0)
  const [search, setSearch] = useState(urlParams.get('search') || '')
  const [segment, setSegment] = useState(urlParams.get('segment') || '')
  const [stage, setStage] = useState(urlParams.get('stage') || '')
  const [unsub, setUnsub] = useState(urlParams.get('unsubscribed') || '')
  const [onlyBounced, setOnlyBounced] = useState(urlParams.get('onlyBounced') === '1')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'table'
    return (localStorage.getItem('marketing.contatos.view') as ViewMode) || 'table'
  })

  function switchView(v: ViewMode) {
    setView(v)
    try { localStorage.setItem('marketing.contatos.view', v) } catch {}
  }

  async function fetchStats() {
    try {
      const r = await fetch('/api/marketing/contatos/stats')
      if (r.ok) setStats((await r.json()).data)
    } catch {}
  }

  async function fetchContacts() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', '50')
      if (search) params.set('search', search)
      const tags: string[] = []
      if (segment) tags.push(`segment:${segment}`)
      if (stage) tags.push(`stage:${stage}`)
      if (tags.length) params.set('tags', tags.join(','))
      if (unsub) params.set('unsubscribed', unsub)
      if (onlyBounced) params.set('onlyBounced', '1')

      const r = await fetch('/api/marketing/contatos?' + params.toString())
      if (r.ok) {
        const j = await r.json()
        setContacts(j.data || [])
        setTotalItems(j.total || 0)
        setTotalPages(j.totalPages || 1)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [])
  useEffect(() => { fetchContacts() }, [page, search, segment, stage, unsub, onlyBounced])

  async function handleSaveAsSegment() {
    const name = prompt('Nome do segmento (ex: "Clientes B2C atendidos 2024"):')?.trim()
    if (!name) return
    const description = prompt('Descrição (opcional):')?.trim() || undefined
    const filters: any = {}
    if (search) filters.search = search
    if (segment) filters.segment = segment
    if (stage) filters.stage = stage
    if (unsub) filters.unsubscribed = unsub
    if (onlyBounced) filters.onlyBounced = true

    try {
      const r = await fetch('/api/marketing/segmentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, filters }),
      })
      if (r.ok) {
        const j = await r.json()
        if (confirm(`Segmento "${name}" criado! Ir para a página de segmentos?`)) {
          window.location.href = `/marketing/segmentos/${j.data.segment.id}`
        }
      } else if (r.status === 409) alert('Já existe um segmento com este nome.')
      else alert('Erro ao salvar segmento.')
    } catch {
      alert('Erro de rede.')
    }
  }

  const hasFilters = search || segment || stage || unsub || onlyBounced
  function clearFilters() {
    setSearch(''); setSegment(''); setStage(''); setUnsub(''); setOnlyBounced(false); setPage(1)
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Contatos</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Base de marketing — {stats ? `${stats.total.toLocaleString('pt-BR')} contatos` : 'carregando…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle vista Tabela / Kanban */}
          <div className="inline-flex rounded-md border border-gray-300 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800" role="group" aria-label="Modo de visualização">
            <button
              type="button"
              onClick={() => switchView('table')}
              className={`inline-flex items-center gap-1 rounded-l-md px-3 py-2 text-sm transition ${view === 'table' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              title={view === 'table' ? 'Visualização em tabela (atual)' : 'Mudar para visualização em tabela'}
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">Tabela</span>
            </button>
            <button
              type="button"
              onClick={() => switchView('kanban')}
              className={`inline-flex items-center gap-1 rounded-r-md px-3 py-2 text-sm transition ${view === 'kanban' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              title={view === 'kanban' ? 'Visualização em Kanban (atual)' : 'Mudar para visualização em Kanban (funil)'}
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">Kanban</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleSaveAsSegment}
            disabled={!hasFilters}
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20"
            title={hasFilters ? 'Salvar filtros atuais como segmento' : 'Aplique pelo menos 1 filtro pra salvar'}
          >
            <Bookmark className="h-4 w-4" />
            <span className="hidden sm:inline">Salvar como segmento</span>
          </button>
        </div>
      </div>

      {/* Stat cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total de contatos" value={stats.total} icon={Users} tone="default" />
          <StatCard
            label="Pessoa física / Empresa"
            value={`${stats.segments.b2c.toLocaleString('pt-BR')} / ${stats.segments.b2b.toLocaleString('pt-BR')}`}
            icon={UserIcon}
            tone="blue"
          />
          <StatCard
            label="Com bounce"
            value={stats.bounced}
            hint="Reputação cai se >5%"
            icon={MailWarning}
            tone={stats.bounced / Math.max(stats.total, 1) > 0.05 ? 'rose' : 'amber'}
          />
          <StatCard label="Descadastrados" value={stats.unsubscribed} icon={MailX} tone="gray" />
        </div>
      )}

      {/* Funnel summary */}
      {stats && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Distribuição por fase</h3>
            <span className="text-xs text-gray-500">total: {stats.total.toLocaleString('pt-BR')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {STAGES.map(s => {
              const count = (stats.stages as any)[s.key] ?? 0
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0
              const active = stage === s.key
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => { setPage(1); setStage(active ? '' : s.key) }}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white dark:border-gray-700 dark:bg-gray-900/50 dark:hover:border-gray-600'
                  }`}
                  title={s.description}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                    <span>{s.emoji}</span> {s.label}
                  </span>
                  <span className="text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {count.toLocaleString('pt-BR')}
                  </span>
                  <span className="text-[10px] text-gray-500">{pct.toFixed(1)}%</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
          <div className="md:col-span-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por email, nome ou telefone…"
                className="w-full rounded-md border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                value={search}
                onChange={e => { setPage(1); setSearch(e.target.value) }}
              />
            </div>
          </div>
          <select
            aria-label="Filtrar por segmento"
            className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 md:col-span-2"
            value={segment}
            onChange={e => { setPage(1); setSegment(e.target.value) }}
          >
            <option value="">Todos segmentos</option>
            <option value="b2c">👤 Pessoa física</option>
            <option value="b2b">🏢 Empresa</option>
          </select>
          <select
            aria-label="Filtrar por fase do funil"
            className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 md:col-span-2"
            value={stage}
            onChange={e => { setPage(1); setStage(e.target.value) }}
          >
            <option value="">Todas as fases</option>
            {STAGES.map(s => (
              <option key={s.key} value={s.key}>{s.emoji} {s.label}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar por status de inscrição"
            className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 md:col-span-2"
            value={unsub}
            onChange={e => { setPage(1); setUnsub(e.target.value) }}
          >
            <option value="">Todos status</option>
            <option value="false">Só inscritos</option>
            <option value="true">Só descadastrados</option>
          </select>
          <label className="inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-2 text-xs shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 md:col-span-1">
            <input type="checkbox" checked={onlyBounced} onChange={e => { setPage(1); setOnlyBounced(e.target.checked) }} className="rounded" />
            Bounce
          </label>
        </div>
        {hasFilters && (
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-gray-500">Filtros aplicados — {total.toLocaleString('pt-BR')} resultado{total !== 1 ? 's' : ''}</span>
            <button type="button" onClick={clearFilters} className="text-blue-600 hover:underline dark:text-blue-400">Limpar filtros</button>
          </div>
        )}
      </div>

      {/* KANBAN VIEW (alternativa à tabela) */}
      {view === 'kanban' && (
        <KanbanBoard filters={{ search, segment, unsubscribed: unsub, onlyBounced }} />
      )}

      {/* Lista (tabela) — só renderiza em view=table */}
      {view === 'table' && (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={Inbox}
              title="Nenhum contato encontrado"
              description={hasFilters ? "Tente ajustar os filtros." : "Sua base de contatos está vazia."}
              action={hasFilters ? { label: 'Limpar filtros', onClick: clearFilters } : undefined}
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/60">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3 font-medium">Contato</th>
                    <th className="px-4 py-3 font-medium">Tags</th>
                    <th className="px-4 py-3 font-medium">Último sinal</th>
                    <th className="px-4 py-3 text-right font-medium">Atividade</th>
                    <th className="px-2 py-3"><span className="sr-only">Ação</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                  {contacts.map(c => (
                    <tr key={c.id} className="group hover:bg-gray-50 dark:hover:bg-gray-900/40">
                      <td className="px-4 py-3">
                        <Link href={`/marketing/contatos/${c.id}`} className="flex items-center gap-3">
                          <ContactAvatar name={c.name} email={c.email} size="sm" />
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-medium ${c.unsubscribed ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-gray-100'}`}>
                              {c.name || c.email}
                            </div>
                            <div className="truncate text-xs text-gray-500">{c.email}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <TagList tags={c.tags} max={4} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500" title={formatDateAbsolute(c.last_seen_at)}>
                        {formatRelative(c.last_seen_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2 text-xs">
                          {c.last_opened_at && (
                            <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400" title={`Aberto ${formatDateAbsolute(c.last_opened_at)}`}>
                              <Mail className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {c.last_clicked_at && (
                            <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400" title={`Clicado ${formatDateAbsolute(c.last_clicked_at)}`}>
                              <MousePointerClick className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {c.bounce_count > 0 && (
                            <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" title={`${c.bounce_count} bounces`}>
                              B{c.bounce_count}
                            </span>
                          )}
                          {c.unsubscribed && (
                            <span className="inline-flex items-center gap-1 text-orange-500" title="Descadastrado">
                              <MailX className="h-3.5 w-3.5" />
                            </span>
                          )}
                          {!c.last_opened_at && !c.last_clicked_at && c.bounce_count === 0 && !c.unsubscribed && (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <Link
                          href={`/marketing/contatos/${c.id}`}
                          className="inline-flex items-center text-gray-400 opacity-0 transition group-hover:opacity-100 hover:text-blue-600 dark:hover:text-blue-400"
                          aria-label="Ver detalhes"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm dark:border-gray-700">
                <span className="text-gray-500">
                  Mostrando {((page - 1) * 50 + 1).toLocaleString('pt-BR')}–{Math.min(page * 50, total).toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-900/40"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >Anterior</button>
                  <span className="px-2 text-xs text-gray-500">Página {page} de {totalPages}</span>
                  <button
                    type="button"
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-900/40"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  >Próxima</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      )}
    </div>
  )
}
