'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ArrowLeft, Edit, Camera, History, Info, Package } from 'lucide-react'

interface Customer {
  id: string
  legal_name: string
  trade_name: string | null
  person_type: string
  document_number: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  address_city: string | null
  address_state: string | null
}

interface OSItem {
  id: string
  description: string | null
  product_id: string | null
  quantity: number
  unit_price_cents: number
  total_cents: number
  item_type: string
}

interface OSPhoto {
  id: string
  photo_url: string
  description: string | null
  created_at: string
}

interface OSHistoryEntry {
  id: string
  from_status_id: string | null
  to_status_id: string | null
  changed_by: string | null
  notes: string | null
  created_at: string
}

interface KanbanColumn {
  id: string
  name: string
  color: string
  order: number
}

interface OSDetail {
  id: string
  os_number: number
  status_id: string
  priority: string
  os_type: string
  equipment_type: string | null
  equipment_brand: string | null
  equipment_model: string | null
  serial_number: string | null
  reported_issue: string | null
  diagnosis: string | null
  reception_notes: string | null
  internal_notes: string | null
  estimated_cost: number
  approved_cost: number
  total_parts: number
  total_services: number
  total_cost: number
  warranty_until: string | null
  estimated_delivery: string | null
  actual_delivery: string | null
  created_at: string
  updated_at: string
  customers: Customer | null
  service_order_items: OSItem[]
  service_order_photos: OSPhoto[]
  service_order_history: OSHistoryEntry[]
}

const tabs = [
  { key: 'info', label: 'Informacoes', icon: Info },
  { key: 'itens', label: 'Itens', icon: Package },
  { key: 'fotos', label: 'Fotos', icon: Camera },
  { key: 'historico', label: 'Historico', icon: History },
] as const

type Tab = typeof tabs[number]['key']

const priorityLabel: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function OSDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [os, setOs] = useState<OSDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('info')
  const [statusMap, setStatusMap] = useState<Record<string, KanbanColumn>>({})
  const [statusList, setStatusList] = useState<KanbanColumn[]>([])
  const [transitioning, setTransitioning] = useState(false)

  useEffect(() => {
    // Load status definitions
    fetch('/api/os/kanban')
      .then(r => r.json())
      .then(d => {
        const cols: KanbanColumn[] = d.data ?? []
        setStatusList(cols)
        const map: Record<string, KanbanColumn> = {}
        cols.forEach(col => { map[col.id] = col })
        setStatusMap(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`/api/os/${id}`)
      .then(r => r.json())
      .then(d => setOs(d.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  function getNextStatus(): KanbanColumn | null {
    if (!os) return null
    const current = statusMap[os.status_id]
    if (!current) return null
    const next = statusList.find(s => s.order === current.order + 1)
    return next ?? null
  }

  async function handleAdvance() {
    const next = getNextStatus()
    if (!os || !next) return
    setTransitioning(true)
    try {
      await fetch(`/api/os/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStatusId: next.id }),
      })
      // Reload OS
      const res = await fetch(`/api/os/${id}`)
      const d = await res.json()
      setOs(d.data ?? null)
    } catch {
      // ignore
    } finally {
      setTransitioning(false)
    }
  }

  if (loading) return <p className="p-6 text-gray-400">Carregando...</p>
  if (!os) return <p className="p-6 text-red-500">OS nao encontrada</p>

  const currentStatus = statusMap[os.status_id]
  const nextStatus = getNextStatus()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/os" className="rounded-md p-1.5 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">OS-{String(os.os_number).padStart(4, '0')}</h1>
          {currentStatus && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: currentStatus.color + '20', color: currentStatus.color }}
            >
              {currentStatus.name}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {nextStatus && (
            <button
              onClick={handleAdvance}
              disabled={transitioning}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {transitioning ? '...' : `Avancar para ${nextStatus.name}`}
            </button>
          )}
          <Link href={`/os/${id}/editar`} className="flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50">
            <Edit className="h-4 w-4" /> Editar
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        {tab === 'info' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cliente" value={os.customers?.legal_name ?? 'Sem cliente'} />
            <Field label="Telefone" value={os.customers?.mobile || os.customers?.phone || '—'} />
            <Field label="Email" value={os.customers?.email || '—'} />
            <Field label="Tipo" value={os.os_type} />
            <Field label="Equipamento" value={os.equipment_type || '—'} />
            <Field label="Marca / Modelo" value={`${os.equipment_brand || ''} ${os.equipment_model || ''}`.trim() || '—'} />
            <Field label="N. Serie" value={os.serial_number || '—'} />
            <Field label="Prioridade" value={priorityLabel[os.priority] ?? os.priority} />
            <Field label="Data Abertura" value={new Date(os.created_at).toLocaleDateString('pt-BR')} />
            <Field label="Previsao Entrega" value={os.estimated_delivery ? new Date(os.estimated_delivery).toLocaleDateString('pt-BR') : '—'} />
            <Field label="Custo Estimado" value={formatCurrency(os.estimated_cost)} />
            <Field label="Custo Total" value={formatCurrency(os.total_cost)} />
            <div className="sm:col-span-2"><Field label="Defeito Relatado" value={os.reported_issue || '—'} /></div>
            <div className="sm:col-span-2"><Field label="Diagnostico" value={os.diagnosis || '—'} /></div>
            {os.internal_notes && <div className="sm:col-span-2"><Field label="Notas Internas" value={os.internal_notes} /></div>}
          </div>
        )}

        {tab === 'itens' && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium uppercase text-gray-500">
                <th className="pb-2">Descricao</th>
                <th className="pb-2">Tipo</th>
                <th className="pb-2">Qtd</th>
                <th className="pb-2">Valor Unit.</th>
                <th className="pb-2">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(os.service_order_items ?? []).length === 0 ? (
                <tr><td colSpan={5} className="py-4 text-gray-400">Nenhum item adicionado</td></tr>
              ) : os.service_order_items.map(item => (
                <tr key={item.id}>
                  <td className="py-2">{item.description || '—'}</td>
                  <td className="py-2 text-xs text-gray-500">{item.item_type}</td>
                  <td className="py-2">{item.quantity}</td>
                  <td className="py-2">{formatCurrency(item.unit_price_cents)}</td>
                  <td className="py-2 font-medium">{formatCurrency(item.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'fotos' && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {(os.service_order_photos ?? []).length === 0 ? (
              <p className="col-span-full text-gray-400">Nenhuma foto</p>
            ) : os.service_order_photos.map(f => (
              <div key={f.id} className="overflow-hidden rounded-lg border">
                <img src={f.photo_url} alt={f.description || ''} className="aspect-square w-full object-cover" />
                <p className="p-2 text-xs text-gray-500">{f.description || new Date(f.created_at).toLocaleDateString('pt-BR')}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'historico' && (
          <ul className="space-y-3">
            {(os.service_order_history ?? []).length === 0 ? (
              <li className="text-gray-400">Nenhum registro</li>
            ) : os.service_order_history.map(h => {
              const fromName = h.from_status_id ? statusMap[h.from_status_id]?.name : null
              const toName = h.to_status_id ? statusMap[h.to_status_id]?.name : null
              const action = fromName && toName
                ? `${fromName} -> ${toName}`
                : toName
                  ? `Criada como ${toName}`
                  : h.notes || 'Alteracao'
              return (
                <li key={h.id} className="flex items-start gap-3 text-sm">
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                  <div>
                    <p className="text-gray-700">{action}</p>
                    {h.notes && <p className="text-xs text-gray-500">{h.notes}</p>}
                    <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleString('pt-BR')}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm text-gray-900">{value}</p>
    </div>
  )
}
