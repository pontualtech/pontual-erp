'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Search, Loader2, Mail, MousePointerClick, MailX, BarChart3, ChevronRight } from 'lucide-react'

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

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: number | string; hint?: string; icon: any }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
        <Icon className="h-4 w-4 text-gray-400" />
      </div>
      <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
      </div>
      {hint && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  )
}

export default function MarketingContatosPage() {
  const router = useRouter()
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

  function tagBadge(tag: string) {
    const isStage = tag.startsWith('stage:')
    const isSeg = tag.startsWith('segment:')
    const isOrigin = tag.startsWith('origin:')
    let cls = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
    if (isStage) cls = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    else if (isSeg) cls = 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
    else if (isOrigin) cls = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    return (
      <span key={tag} className={`inline-block rounded px-1.5 py-0.5 text-xs ${cls}`}>{tag}</span>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Marketing — Contatos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Base de contatos para campanhas de email/SMS. {stats && `${stats.total.toLocaleString('pt-BR')} contatos.`}
          </p>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total" value={stats.total} icon={BarChart3} />
          <StatCard label="B2C / B2B" value={`${stats.segments.b2c.toLocaleString('pt-BR')} / ${stats.segments.b2b.toLocaleString('pt-BR')}`} icon={BarChart3} />
          <StatCard label="Com bounce" value={stats.bounced} hint="Pode prejudicar reputação" icon={MailX} />
          <StatCard label="Descadastrados" value={stats.unsubscribed} icon={MailX} />
        </div>
      )}

      {/* Filtros */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar email, nome ou telefone…"
                className="w-full rounded-md border border-gray-300 bg-white pl-8 pr-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                value={search}
                onChange={e => { setPage(1); setSearch(e.target.value) }}
              />
            </div>
          </div>
          <select className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            value={segment} onChange={e => { setPage(1); setSegment(e.target.value) }}>
            <option value="">Todos segmentos</option>
            <option value="b2c">B2C</option>
            <option value="b2b">B2B</option>
          </select>
          <select className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            value={stage} onChange={e => { setPage(1); setStage(e.target.value) }}>
            <option value="">Todas fases</option>
            <option value="lead_aguardando">Lead aguardando</option>
            <option value="em_negociacao">Em negociação</option>
            <option value="cliente_em_servico">Cliente em serviço</option>
            <option value="cliente_atendido">Cliente atendido</option>
            <option value="perdido_recusou">Perdido (recusou)</option>
          </select>
          <select className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            value={unsub} onChange={e => { setPage(1); setUnsub(e.target.value) }}>
            <option value="">Inscritos + desc.</option>
            <option value="false">Só inscritos</option>
            <option value="true">Só descadastrados</option>
          </select>
        </div>
        <div className="mt-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={onlyBounced} onChange={e => { setPage(1); setOnlyBounced(e.target.checked) }} />
            Apenas contatos com bounce
          </label>
        </div>
      </div>

      {/* Lista */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-4 py-2 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {total.toLocaleString('pt-BR')} contatos · página {page} de {totalPages}
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">Nenhum contato encontrado com esses filtros.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Tags</th>
                  <th className="px-3 py-2">Último sinal</th>
                  <th className="px-3 py-2">Sinais</th>
                  <th className="px-3 py-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/40">
                    <td className="px-3 py-2 font-mono text-xs">
                      <span className={c.unsubscribed ? 'line-through text-gray-400' : ''}>{c.email}</span>
                    </td>
                    <td className="px-3 py-2">{c.name || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 6).map(tagBadge)}
                        {c.tags.length > 6 && <span className="text-xs text-gray-400">+{c.tags.length - 6}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(c.last_seen_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        {c.last_opened_at && <span title={`opened ${fmtDate(c.last_opened_at)}`}><Mail className="inline h-3 w-3 text-blue-500" /></span>}
                        {c.last_clicked_at && <span title={`clicked ${fmtDate(c.last_clicked_at)}`}><MousePointerClick className="inline h-3 w-3 text-purple-500" /></span>}
                        {c.bounce_count > 0 && <span title={`${c.bounce_count} bounces`} className="text-red-500">B{c.bounce_count}</span>}
                        {c.unsubscribed && <span title="unsubscribed"><MailX className="inline h-3 w-3 text-orange-500" /></span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/marketing/contatos/${c.id}`} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline" title="Ver detalhes">
                        ver <ChevronRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-sm dark:border-gray-700">
            <button
              type="button"
              className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-50 dark:border-gray-600"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >Anterior</button>
            <span className="text-gray-500 dark:text-gray-400">Página {page} de {totalPages}</span>
            <button
              type="button"
              className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-50 dark:border-gray-600"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >Próxima</button>
          </div>
        )}
      </div>
    </div>
  )
}
