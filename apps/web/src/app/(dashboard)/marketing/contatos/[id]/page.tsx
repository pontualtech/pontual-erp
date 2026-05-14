'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, Mail, MousePointerClick, MailX, AlertTriangle, Send, CheckCheck, Ban, ArrowLeft, ExternalLink } from 'lucide-react'

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

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function eventIcon(type: string) {
  switch (type) {
    case 'email.sent': return <Send className="h-4 w-4 text-gray-500" />
    case 'email.delivered': return <CheckCheck className="h-4 w-4 text-green-500" />
    case 'email.opened': return <Mail className="h-4 w-4 text-blue-500" />
    case 'email.clicked': return <MousePointerClick className="h-4 w-4 text-purple-500" />
    case 'email.bounced': return <AlertTriangle className="h-4 w-4 text-red-500" />
    case 'email.complained': return <Ban className="h-4 w-4 text-orange-500" />
    case 'email.unsubscribed': return <MailX className="h-4 w-4 text-orange-500" />
    default: return <Send className="h-4 w-4 text-gray-400" />
  }
}

function eventLabel(type: string) {
  return type.replace('email.', '')
}

export default function ContatoDetalhePage() {
  const router = useRouter()
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
        else setError('Erro ao carregar')
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
      <div className="p-6">
        <Link href="/marketing/contatos" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <p className="mt-4 text-sm text-gray-500">{error || 'Sem dados'}</p>
      </div>
    )
  }

  const { contact, customer, events, stats } = data

  return (
    <div className="p-6">
      <Link href="/marketing/contatos" className="mb-4 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Voltar para contatos
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {contact.name || contact.email}
          </h1>
          <p className="font-mono text-sm text-gray-500 dark:text-gray-400">
            {contact.email}
            {contact.unsubscribed && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">descadastrado</span>}
          </p>
        </div>
      </div>

      {/* Stats agregadas */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ['Enviados', stats.sent, 'gray'],
          ['Entregues', stats.delivered, 'green'],
          ['Abertos', stats.opened, 'blue'],
          ['Cliques', stats.clicked, 'purple'],
          ['Bounces', stats.bounced, 'red'],
          ['Spam/Unsub', stats.complained + stats.unsubscribed, 'orange'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="text-xs text-gray-500 dark:text-gray-400">{String(label)}</div>
            <div className={`mt-1 text-xl font-semibold text-${color}-600 dark:text-${color}-400`}>{Number(value).toLocaleString('pt-BR')}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sidebar: dados básicos */}
        <div className="space-y-3 lg:col-span-1">
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Contato</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="text-xs text-gray-500">Origem</dt><dd className="text-gray-900 dark:text-gray-100">{contact.origin}</dd></div>
              <div><dt className="text-xs text-gray-500">Telefone</dt><dd className="text-gray-900 dark:text-gray-100">{contact.phone || '—'}</dd></div>
              <div><dt className="text-xs text-gray-500">Documento</dt><dd className="font-mono text-xs text-gray-900 dark:text-gray-100">{contact.document_number || '—'}</dd></div>
              <div><dt className="text-xs text-gray-500">Visto pela 1ª vez</dt><dd className="text-gray-900 dark:text-gray-100">{fmtDate(contact.created_at)}</dd></div>
              <div><dt className="text-xs text-gray-500">Última atividade</dt><dd className="text-gray-900 dark:text-gray-100">{fmtDate(contact.last_seen_at)}</dd></div>
              <div><dt className="text-xs text-gray-500">Total bounces</dt><dd className={contact.bounce_count > 0 ? 'text-red-600 font-semibold' : 'text-gray-900 dark:text-gray-100'}>{contact.bounce_count}</dd></div>
            </dl>
          </div>

          {/* Tags */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tags</h3>
            <div className="mt-3 flex flex-wrap gap-1">
              {contact.tags.length === 0 && <span className="text-xs text-gray-500">Sem tags</span>}
              {contact.tags.map(t => {
                const isStage = t.startsWith('stage:')
                const isSeg = t.startsWith('segment:')
                const isOrigin = t.startsWith('origin:')
                let cls = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                if (isStage) cls = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                else if (isSeg) cls = 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                else if (isOrigin) cls = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                return <span key={t} className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{t}</span>
              })}
            </div>
          </div>

          {/* Customer linkado */}
          {customer && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Cliente vinculado</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-gray-500">Nome</dt>
                  <dd>
                    <Link href={`/clientes/${customer.id}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                      {customer.trade_name || customer.legal_name}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </dd>
                </div>
                <div><dt className="text-xs text-gray-500">Tipo</dt><dd>{customer.person_type === 'JURIDICA' ? 'PJ' : 'PF'}</dd></div>
                <div><dt className="text-xs text-gray-500">Cidade/UF</dt><dd>{customer.address_city || '—'}/{customer.address_state || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Total OS</dt><dd>{customer.total_os || 0}</dd></div>
                <div><dt className="text-xs text-gray-500">Última OS</dt><dd>{fmtDate(customer.last_os_at)}</dd></div>
              </dl>
            </div>
          )}
        </div>

        {/* Timeline de eventos */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Timeline ({events.length} eventos)</h3>
            </div>
            {events.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-gray-500">Nenhum evento registrado pra este contato ainda.</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {events.map(ev => {
                  const subject = ev.raw_payload?.data?.subject || '(sem assunto)'
                  const campaign = ev.raw_payload?.data?.tags?.campaign
                  const clickLink = ev.raw_payload?.data?.click?.link
                  return (
                    <li key={ev.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="mt-0.5">{eventIcon(ev.event_type)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{eventLabel(ev.event_type)}</div>
                          <div className="text-xs text-gray-500">{fmtDate(ev.received_at)}</div>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">{subject}</div>
                        {campaign && <span className="mt-1 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{campaign}</span>}
                        {clickLink && <div className="mt-1 truncate text-xs text-purple-600">→ {clickLink}</div>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
