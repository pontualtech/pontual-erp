'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  Loader2, Mail, MousePointerClick, MailX, AlertTriangle, Send, CheckCheck, Ban,
  ArrowLeft, ExternalLink, Building2, User as UserIcon, MapPin, Calendar,
} from 'lucide-react'
import { ContactAvatar } from '@/components/marketing/ContactAvatar'
import { TagList } from '@/components/marketing/TagBadge'
import { StatCard } from '@/components/marketing/StatCard'
import { EmptyState } from '@/components/marketing/EmptyState'
import { formatRelative, formatDateAbsolute, formatDateShort } from '@/lib/marketing/format'

interface Contact {
  id: string
  email: string
  name: string | null
  phone: string | null
  document_number: string | null
  origin: string
  tags: string[]
  customer_id: string | null
  unsubscribed: boolean
  bounce_count: number
  last_sent_at: string | null
  last_opened_at: string | null
  last_clicked_at: string | null
  last_seen_at: string | null
  metadata: any
  created_at: string | null
}

interface CustomerLink {
  id: string
  legal_name: string
  trade_name: string | null
  person_type: string
  document_number: string | null
  address_city: string | null
  address_state: string | null
  total_os: number | null
  last_os_at: string | null
}

interface WebhookEvent {
  id: string
  event_type: string
  received_at: string
  status: string
  raw_payload: any
}

interface ApiResponse {
  contact: Contact
  customer: CustomerLink | null
  events: WebhookEvent[]
  stats: {
    total_events: number
    sent: number
    delivered: number
    opened: number
    clicked: number
    bounced: number
    complained: number
    unsubscribed: number
  }
}

// Mapa de eventos: ícone + cor + label PT-BR
const EVENT_CONFIG: Record<string, { icon: typeof Send; color: string; bg: string; label: string }> = {
  'email.sent':         { icon: Send,           color: 'text-gray-500',   bg: 'bg-gray-100 dark:bg-gray-700',           label: 'Enviado'        },
  'email.delivered':    { icon: CheckCheck,     color: 'text-green-600',  bg: 'bg-green-100 dark:bg-green-500/20',      label: 'Entregue'       },
  'email.opened':       { icon: Mail,           color: 'text-blue-600',   bg: 'bg-blue-100 dark:bg-blue-500/20',        label: 'Aberto'         },
  'email.clicked':      { icon: MousePointerClick, color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-500/20', label: 'Clicou no link' },
  'email.bounced':      { icon: AlertTriangle,  color: 'text-red-600',    bg: 'bg-red-100 dark:bg-red-500/20',          label: 'Rejeitado (bounce)' },
  'email.complained':   { icon: Ban,            color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-500/20',    label: 'Marcou como spam'   },
  'email.unsubscribed': { icon: MailX,          color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-500/20',    label: 'Descadastrou-se'    },
}

function eventCfg(type: string) {
  return EVENT_CONFIG[type] || { icon: Send, color: 'text-gray-400', bg: 'bg-gray-100', label: type.replace('email.', '') }
}

/** Agrupa eventos por dia (chave = '2026-05-15') */
function groupByDay(events: WebhookEvent[]) {
  const groups: Record<string, WebhookEvent[]> = {}
  for (const ev of events) {
    const day = ev.received_at.slice(0, 10)
    if (!groups[day]) groups[day] = []
    groups[day].push(ev)
  }
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
}

function dayHeading(dayKey: string): string {
  const d = new Date(dayKey + 'T12:00:00')
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  if (dayKey === today) return 'Hoje'
  if (dayKey === yesterday) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

export default function ContatoDetalhePage() {
  const params = useParams<{ id: string }>()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const r = await fetch(`/api/marketing/contatos/${params.id}?limit=100`)
        if (r.ok) setData(await r.json().then(j => j.data))
        else if (r.status === 404) setError('Contato não encontrado')
        else setError('Erro ao carregar contato')
      } catch {
        setError('Erro de rede')
      } finally {
        setLoading(false)
      }
    }
    if (params.id) load()
  }, [params.id])

  if (loading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl p-6 lg:p-8">
        <Link href="/marketing/contatos" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Voltar para contatos
        </Link>
        <div className="mt-4">
          <EmptyState
            title={error || 'Sem dados'}
            description="Verifique o link ou tente recarregar a página."
            action={{ label: 'Voltar para contatos', href: '/marketing/contatos' }}
          />
        </div>
      </div>
    )
  }

  const { contact, customer, events, stats } = data
  const grouped = groupByDay(events)

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <Link href="/marketing/contatos" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400">
        <ArrowLeft className="h-4 w-4" /> Voltar para contatos
      </Link>

      {/* Header com avatar */}
      <div className="mt-3 flex items-center gap-4 border-b border-gray-200 pb-5 dark:border-gray-700">
        <ContactAvatar name={contact.name} email={contact.email} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {contact.name || contact.email}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span className="font-mono">{contact.email}</span>
            {contact.unsubscribed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-300">
                <MailX className="h-3 w-3" /> Descadastrado
              </span>
            )}
            {contact.bounce_count > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300">
                <AlertTriangle className="h-3 w-3" /> {contact.bounce_count} bounce{contact.bounce_count > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 6 stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Enviados"    value={stats.sent}      icon={Send}              tone="default" />
        <StatCard label="Entregues"   value={stats.delivered} icon={CheckCheck}        tone="green"   hint={stats.sent > 0 ? `${(stats.delivered/stats.sent*100).toFixed(0)}%` : undefined} />
        <StatCard label="Abertos"     value={stats.opened}    icon={Mail}              tone="blue"    hint={stats.delivered > 0 ? `${(stats.opened/stats.delivered*100).toFixed(0)}%` : undefined} />
        <StatCard label="Cliques"     value={stats.clicked}   icon={MousePointerClick} tone="blue"    />
        <StatCard label="Bounces"     value={stats.bounced}   icon={AlertTriangle}     tone="rose"    />
        <StatCard label="Spam/Unsub"  value={stats.complained + stats.unsubscribed} icon={MailX} tone="amber" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Sidebar */}
        <aside className="space-y-3 lg:col-span-1">
          {/* Contato — dados básicos */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Dados do contato</h3>
            <dl className="mt-3 space-y-2.5 text-sm">
              {contact.phone && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400">Telefone</dt>
                  <dd className="mt-0.5 font-mono text-gray-900 dark:text-gray-100">{contact.phone}</dd>
                </div>
              )}
              {contact.document_number && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400">Documento</dt>
                  <dd className="mt-0.5 font-mono text-xs text-gray-700 dark:text-gray-300">{contact.document_number}</dd>
                </div>
              )}
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-gray-400">
                  <Calendar className="h-3 w-3" /> Visto pela 1ª vez
                </dt>
                <dd className="mt-0.5 text-gray-900 dark:text-gray-100" title={formatDateAbsolute(contact.created_at)}>
                  {formatRelative(contact.created_at)}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-gray-400">
                  <Calendar className="h-3 w-3" /> Última atividade
                </dt>
                <dd className="mt-0.5 text-gray-900 dark:text-gray-100" title={formatDateAbsolute(contact.last_seen_at)}>
                  {formatRelative(contact.last_seen_at)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Tags */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Tags <span className="ml-1 text-xs text-gray-400">({contact.tags.length})</span>
            </h3>
            <div className="mt-3">
              {contact.tags.length === 0 ? (
                <p className="text-xs text-gray-500">Sem tags ainda</p>
              ) : (
                <TagList tags={contact.tags} size="md" />
              )}
            </div>
          </div>

          {/* Cliente vinculado */}
          {customer && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {customer.person_type === 'JURIDICA' ? <Building2 className="h-4 w-4 text-violet-500" /> : <UserIcon className="h-4 w-4 text-purple-500" />}
                Cliente vinculado
              </h3>
              <div className="mt-3 space-y-2.5">
                <Link
                  href={`/clientes/${customer.id}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  {customer.trade_name || customer.legal_name}
                  <ExternalLink className="h-3 w-3" />
                </Link>
                <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">
                    {customer.person_type === 'JURIDICA' ? 'Empresa' : 'Pessoa física'}
                  </span>
                  {(customer.address_city || customer.address_state) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {customer.address_city || '—'}/{customer.address_state || '—'}
                    </span>
                  )}
                </div>
                <dl className="space-y-1.5 border-t border-gray-100 pt-3 text-xs dark:border-gray-700">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Total OS</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">{customer.total_os || 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Última OS</dt>
                    <dd className="text-gray-900 dark:text-gray-100" title={formatDateAbsolute(customer.last_os_at)}>
                      {customer.last_os_at ? formatRelative(customer.last_os_at) : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </aside>

        {/* Timeline */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Histórico de eventos
              </h3>
              <span className="text-xs text-gray-500">{events.length} evento{events.length !== 1 ? 's' : ''}</span>
            </div>

            {events.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={Mail}
                  title="Nenhum evento ainda"
                  description="Quando este contato receber um email da campanha, os eventos aparecem aqui (entregues, abertos, cliques, bounces)."
                />
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {grouped.map(([day, dayEvents]) => (
                  <div key={day} className="px-5 py-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {dayHeading(day)}
                      <span className="ml-1 font-normal text-gray-400">· {formatDateShort(day + 'T12:00:00')}</span>
                    </div>
                    <ul className="space-y-2.5">
                      {dayEvents.map(ev => {
                        const cfg = eventCfg(ev.event_type)
                        const Icon = cfg.icon
                        const subject = ev.raw_payload?.data?.subject || '(sem assunto)'
                        const campaign = ev.raw_payload?.data?.tags?.campaign
                        const clickLink = ev.raw_payload?.data?.click?.link
                        return (
                          <li key={ev.id} className="flex items-start gap-3">
                            <div className={`mt-0.5 shrink-0 rounded-full p-1.5 ${cfg.bg}`}>
                              <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {cfg.label}
                                </span>
                                <span className="shrink-0 text-xs text-gray-500" title={formatDateAbsolute(ev.received_at)}>
                                  {new Date(ev.received_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400" title={subject}>
                                {subject}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                {campaign && (
                                  <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 ring-1 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-300">
                                    📊 {campaign}
                                  </span>
                                )}
                                {clickLink && (
                                  <a
                                    href={clickLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 truncate text-[10px] text-purple-600 hover:underline dark:text-purple-400"
                                  >
                                    → {clickLink.slice(0, 60)}{clickLink.length > 60 ? '…' : ''}
                                  </a>
                                )}
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
