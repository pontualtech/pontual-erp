'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Plus, Loader2, FileText, Calendar, DollarSign,
  Wrench, ClipboardList, PauseCircle, XCircle, Receipt, Settings2,
} from 'lucide-react'
import { toast } from 'sonner'

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(d: string | null) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('pt-BR')
}

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Expirado',
}

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
}

const frequencyLabels: Record<string, string> = {
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  BIMONTHLY: 'Bimestral',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
}

const visitStatusLabels: Record<string, string> = {
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'Em Andamento',
  COMPLETED: 'Concluida',
  CANCELLED: 'Cancelada',
}

const visitStatusColors: Record<string, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
}

interface Equipment {
  id: string
  equipment_type: string | null
  brand: string | null
  model: string | null
  serial_number: string | null
  location: string | null
  last_maintenance: string | null
  next_maintenance: string | null
}

interface Visit {
  id: string
  visit_date: string | null
  type: string
  status: string
  notes: string | null
  os_id: string | null
}

interface Contract {
  id: string
  number: string | null
  description: string | null
  start_date: string
  end_date: string
  monthly_value: number
  billing_day: number
  visit_frequency: string
  max_visits_per_period: number | null
  status: string
  auto_renew: boolean
  renewal_alert_days: number
  notes: string | null
  customers: {
    id: string
    legal_name: string
    phone: string | null
    email: string | null
    document_number: string | null
    address_street: string | null
    address_number: string | null
    address_city: string | null
    address_state: string | null
  } | null
  contract_equipment: Equipment[]
  contract_visits: Visit[]
}

export default function ContratoDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [contract, setContract] = useState<Contract | null>(null)
  const [loading, setLoading] = useState(true)

  // Modals
  const [showEquipModal, setShowEquipModal] = useState(false)
  const [showVisitModal, setShowVisitModal] = useState(false)
  const [showBillingModal, setShowBillingModal] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // Equipment form
  const [eqType, setEqType] = useState('')
  const [eqBrand, setEqBrand] = useState('')
  const [eqModel, setEqModel] = useState('')
  const [eqSerial, setEqSerial] = useState('')
  const [eqLocation, setEqLocation] = useState('')

  // Visit form
  const [visitDate, setVisitDate] = useState('')
  const [visitNotes, setVisitNotes] = useState('')
  const [visitEquipType, setVisitEquipType] = useState('')

  // Billing form
  const [billingMonth, setBillingMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/contracts/${id}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setContract(json.data)
    } catch (err: any) {
      toast.error(err.message || 'Erro ao carregar contrato')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  async function handleStatusChange(newStatus: string) {
    if (!confirm(`Confirma alterar status para "${statusLabels[newStatus]}"?`)) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/contracts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      toast.success(`Status alterado para ${statusLabels[newStatus]}`)
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleAddEquipment(e: React.FormEvent) {
    e.preventDefault()
    if (!eqType) { toast.error('Tipo do equipamento e obrigatorio'); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/contracts/${id}/equipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_type: eqType,
          brand: eqBrand || null,
          model: eqModel || null,
          serial_number: eqSerial || null,
          location: eqLocation || null,
        }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      toast.success('Equipamento adicionado')
      setShowEquipModal(false)
      setEqType(''); setEqBrand(''); setEqModel(''); setEqSerial(''); setEqLocation('')
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleScheduleVisit(e: React.FormEvent) {
    e.preventDefault()
    if (!visitDate) { toast.error('Data da visita e obrigatoria'); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/contracts/${id}/visits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visit_date: visitDate,
          notes: visitNotes || null,
          equipment_type: visitEquipType || null,
        }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      toast.success('Visita agendada' + (json.data.os_id ? ' e OS criada' : ''))
      setShowVisitModal(false)
      setVisitDate(''); setVisitNotes(''); setVisitEquipType('')
      load()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleGenerateBilling(e: React.FormEvent) {
    e.preventDefault()
    if (!billingMonth) { toast.error('Informe o mes de referencia'); return }
    setActionLoading(true)
    try {
      const res = await fetch(`/api/contracts/${id}/billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference_month: billingMonth }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      toast.success('Faturamento gerado com sucesso!')
      setShowBillingModal(false)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <FileText className="h-12 w-12 mb-3" />
        <p>Contrato nao encontrado</p>
        <Link href="/contratos" className="mt-4 text-blue-600 hover:underline">Voltar</Link>
      </div>
    )
  }

  const c = contract

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Link href="/contratos" className="mt-1 rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Contrato {c.number || c.id.slice(0, 8)}
              </h1>
              <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-medium', statusColors[c.status] || 'bg-gray-100 text-gray-600')}>
                {statusLabels[c.status] || c.status}
              </span>
            </div>
            {c.description && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{c.description}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowEquipModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            <Wrench className="h-4 w-4" />
            Add Equipamento
          </button>
          <button
            onClick={() => setShowVisitModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            <Calendar className="h-4 w-4" />
            Agendar Visita
          </button>
          <button
            onClick={() => setShowBillingModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Receipt className="h-4 w-4" />
            Gerar Faturamento
          </button>
          {c.status === 'ACTIVE' && (
            <>
              <button
                onClick={() => handleStatusChange('SUSPENDED')}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-300 px-3 py-2 text-sm font-medium text-yellow-700 hover:bg-yellow-50 dark:border-yellow-700 dark:text-yellow-400 dark:hover:bg-yellow-900/20"
              >
                <PauseCircle className="h-4 w-4" />
                Suspender
              </button>
              <button
                onClick={() => handleStatusChange('CANCELLED')}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <XCircle className="h-4 w-4" />
                Cancelar
              </button>
            </>
          )}
          {c.status === 'SUSPENDED' && (
            <button
              onClick={() => handleStatusChange('ACTIVE')}
              disabled={actionLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-green-300 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20"
            >
              Reativar
            </button>
          )}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cliente</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{c.customers?.legal_name}</p>
          {c.customers?.phone && <p className="text-xs text-gray-500">{c.customers.phone}</p>}
          {c.customers?.email && <p className="text-xs text-gray-500">{c.customers.email}</p>}
        </div>
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Periodo</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {fmtDate(c.start_date)} - {fmtDate(c.end_date)}
          </p>
          <p className="text-xs text-gray-500">{c.auto_renew ? 'Renovacao automatica' : 'Sem renovacao automatica'}</p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Valor Mensal</p>
          <p className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">{fmt(c.monthly_value || 0)}</p>
          <p className="text-xs text-gray-500">Vencimento dia {c.billing_day}</p>
        </div>
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Visitas</p>
          <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {frequencyLabels[c.visit_frequency] || c.visit_frequency}
          </p>
          <p className="text-xs text-gray-500">
            {c.max_visits_per_period ? `Max ${c.max_visits_per_period} por periodo` : 'Ilimitado'}
          </p>
        </div>
      </div>

      {/* Notes */}
      {c.notes && (
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Observacoes</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{c.notes}</p>
        </div>
      )}

      {/* Equipment Table */}
      <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between border-b dark:border-gray-700 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Equipamentos ({c.contract_equipment.length})
          </h2>
        </div>
        {c.contract_equipment.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <Wrench className="h-8 w-8 mb-2" />
            <p className="text-sm">Nenhum equipamento cadastrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 dark:bg-gray-900/50 dark:border-gray-700 text-left">
                  <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Tipo</th>
                  <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Marca</th>
                  <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Modelo</th>
                  <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">N/S</th>
                  <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Local</th>
                  <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Ult. Manut.</th>
                  <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Prox. Manut.</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {c.contract_equipment.map(eq => (
                  <tr key={eq.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">{eq.equipment_type || '--'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{eq.brand || '--'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{eq.model || '--'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300 font-mono text-xs">{eq.serial_number || '--'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{eq.location || '--'}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{fmtDate(eq.last_maintenance)}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{fmtDate(eq.next_maintenance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Visits Timeline */}
      <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between border-b dark:border-gray-700 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Visitas ({c.contract_visits.length})
          </h2>
        </div>
        {c.contract_visits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <Calendar className="h-8 w-8 mb-2" />
            <p className="text-sm">Nenhuma visita agendada</p>
          </div>
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {c.contract_visits.map(v => (
              <div key={v.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <ClipboardList className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {v.type === 'PREVENTIVE' ? 'Preventiva' : v.type === 'CORRECTIVE' ? 'Corretiva' : v.type}
                      {' - '}{fmtDate(v.visit_date)}
                    </p>
                    {v.notes && <p className="text-xs text-gray-500 dark:text-gray-400">{v.notes}</p>}
                    {v.os_id && (
                      <Link href={`/os?search=${v.os_id}`} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                        Ver OS vinculada
                      </Link>
                    )}
                  </div>
                </div>
                <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', visitStatusColors[v.status] || 'bg-gray-100 text-gray-600')}>
                  {visitStatusLabels[v.status] || v.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ====== MODALS ====== */}

      {/* Add Equipment Modal */}
      {showEquipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Adicionar Equipamento</h3>
            <form onSubmit={handleAddEquipment} className="space-y-3">
              <input
                type="text"
                value={eqType}
                onChange={e => setEqType(e.target.value)}
                placeholder="Tipo (ex: Impressora) *"
                className="w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={eqBrand}
                  onChange={e => setEqBrand(e.target.value)}
                  placeholder="Marca"
                  className="rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
                />
                <input
                  type="text"
                  value={eqModel}
                  onChange={e => setEqModel(e.target.value)}
                  placeholder="Modelo"
                  className="rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
                />
              </div>
              <input
                type="text"
                value={eqSerial}
                onChange={e => setEqSerial(e.target.value)}
                placeholder="Numero de Serie"
                className="w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
              />
              <input
                type="text"
                value={eqLocation}
                onChange={e => setEqLocation(e.target.value)}
                placeholder="Localizacao"
                className="w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEquipModal(false)}
                  className="rounded-lg border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schedule Visit Modal */}
      {showVisitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Agendar Visita</h3>
            <form onSubmit={handleScheduleVisit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Data da Visita *</label>
                <input
                  type="date"
                  value={visitDate}
                  onChange={e => setVisitDate(e.target.value)}
                  className="w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de Equipamento</label>
                <input
                  type="text"
                  value={visitEquipType}
                  onChange={e => setVisitEquipType(e.target.value)}
                  placeholder="Ex: Impressora HP LaserJet"
                  className="w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Observacoes</label>
                <textarea
                  value={visitNotes}
                  onChange={e => setVisitNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Uma OS preventiva sera criada automaticamente.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowVisitModal(false)}
                  className="rounded-lg border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Agendar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generate Billing Modal */}
      {showBillingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg bg-white dark:bg-gray-800 p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Gerar Faturamento</h3>
            <form onSubmit={handleGenerateBilling} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Mes de Referencia *</label>
                <input
                  type="month"
                  value={billingMonth}
                  onChange={e => setBillingMonth(e.target.value)}
                  className="w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm dark:text-gray-100"
                />
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700 p-3">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Valor: <strong>{fmt(c.monthly_value || 0)}</strong>
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Vencimento: dia <strong>{c.billing_day}</strong>
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBillingModal(false)}
                  className="rounded-lg border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Gerar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
