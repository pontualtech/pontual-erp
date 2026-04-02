'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

interface Customer {
  id: string
  legal_name: string
  document_number: string | null
}

interface EquipmentRow {
  equipment_type: string
  brand: string
  model: string
  serial_number: string
  location: string
}

export default function NovoContratoPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(true)

  // Form state
  const [customerId, setCustomerId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [number, setNumber] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [monthlyValue, setMonthlyValue] = useState('')
  const [billingDay, setBillingDay] = useState('1')
  const [visitFrequency, setVisitFrequency] = useState('MONTHLY')
  const [maxVisits, setMaxVisits] = useState('')
  const [autoRenew, setAutoRenew] = useState(false)
  const [renewalAlertDays, setRenewalAlertDays] = useState('30')
  const [notes, setNotes] = useState('')
  const [equipment, setEquipment] = useState<EquipmentRow[]>([])

  useEffect(() => {
    loadCustomers()
  }, [])

  async function loadCustomers() {
    try {
      const res = await fetch('/api/clientes?limit=500')
      const json = await res.json()
      setCustomers(json.data || [])
    } catch {
      toast.error('Erro ao carregar clientes')
    } finally {
      setLoadingCustomers(false)
    }
  }

  function addEquipment() {
    setEquipment([...equipment, { equipment_type: '', brand: '', model: '', serial_number: '', location: '' }])
  }

  function removeEquipment(idx: number) {
    setEquipment(equipment.filter((_, i) => i !== idx))
  }

  function updateEquipment(idx: number, field: keyof EquipmentRow, value: string) {
    const updated = [...equipment]
    updated[idx] = { ...updated[idx], [field]: value }
    setEquipment(updated)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!customerId) { toast.error('Selecione um cliente'); return }
    if (!startDate) { toast.error('Informe a data de inicio'); return }
    if (!endDate) { toast.error('Informe a data de termino'); return }

    setSaving(true)
    try {
      // Convert monthlyValue (BRL string) to cents
      const valueCents = Math.round(parseFloat(monthlyValue.replace(',', '.') || '0') * 100)

      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          number: number || null,
          description: description || null,
          start_date: startDate,
          end_date: endDate,
          monthly_value: valueCents,
          billing_day: parseInt(billingDay) || 1,
          visit_frequency: visitFrequency,
          max_visits_per_period: maxVisits ? parseInt(maxVisits) : null,
          auto_renew: autoRenew,
          renewal_alert_days: parseInt(renewalAlertDays) || 30,
          notes: notes || null,
          equipment: equipment.filter(eq => eq.equipment_type),
        }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error)

      toast.success('Contrato criado com sucesso!')
      router.push(`/contratos/${json.data.id}`)
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar contrato')
    } finally {
      setSaving(false)
    }
  }

  const filteredCustomers = customerSearch
    ? customers.filter(c => c.legal_name.toLowerCase().includes(customerSearch.toLowerCase()))
    : customers

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/contratos" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Novo Contrato</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Contrato de manutencao preventiva</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Dados do Contrato</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Customer */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Cliente *</label>
              {loadingCustomers ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Buscar cliente..."
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                    className="mb-2 w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
                  />
                  <select
                    value={customerId}
                    onChange={e => setCustomerId(e.target.value)}
                    className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
                    size={Math.min(5, filteredCustomers.length + 1)}
                  >
                    <option value="">Selecione um cliente</option>
                    {filteredCustomers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.legal_name} {c.document_number ? `(${c.document_number})` : ''}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Numero do Contrato</label>
              <input
                type="text"
                value={number}
                onChange={e => setNumber(e.target.value)}
                placeholder="Ex: CT-001"
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Descricao</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ex: Manutencao preventiva de impressoras"
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Data Inicio *</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Data Termino *</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Valor Mensal (R$)</label>
              <input
                type="text"
                value={monthlyValue}
                onChange={e => setMonthlyValue(e.target.value)}
                placeholder="0,00"
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Dia de Faturamento</label>
              <input
                type="number"
                min="1"
                max="28"
                value={billingDay}
                onChange={e => setBillingDay(e.target.value)}
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Frequencia de Visitas</label>
              <select
                value={visitFrequency}
                onChange={e => setVisitFrequency(e.target.value)}
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              >
                <option value="WEEKLY">Semanal</option>
                <option value="BIWEEKLY">Quinzenal</option>
                <option value="MONTHLY">Mensal</option>
                <option value="BIMONTHLY">Bimestral</option>
                <option value="QUARTERLY">Trimestral</option>
                <option value="SEMIANNUAL">Semestral</option>
                <option value="ANNUAL">Anual</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Max Visitas por Periodo</label>
              <input
                type="number"
                min="0"
                value={maxVisits}
                onChange={e => setMaxVisits(e.target.value)}
                placeholder="Ilimitado"
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>

            <div className="flex items-center gap-4 pt-6">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={autoRenew}
                  onChange={e => setAutoRenew(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Renovacao automatica
              </label>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Alerta de Renovacao (dias)</label>
              <input
                type="number"
                min="0"
                value={renewalAlertDays}
                onChange={e => setRenewalAlertDays(e.target.value)}
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Observacoes</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
              />
            </div>
          </div>
        </div>

        {/* Equipment */}
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Equipamentos</h2>
            <button
              type="button"
              onClick={addEquipment}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </button>
          </div>

          {equipment.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">Nenhum equipamento adicionado. Voce pode adicionar depois.</p>
          ) : (
            <div className="space-y-4">
              {equipment.map((eq, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-3 rounded-lg border dark:border-gray-600 p-4 sm:grid-cols-5">
                  <input
                    type="text"
                    value={eq.equipment_type}
                    onChange={e => updateEquipment(idx, 'equipment_type', e.target.value)}
                    placeholder="Tipo (ex: Impressora)"
                    className="rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
                  />
                  <input
                    type="text"
                    value={eq.brand}
                    onChange={e => updateEquipment(idx, 'brand', e.target.value)}
                    placeholder="Marca"
                    className="rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
                  />
                  <input
                    type="text"
                    value={eq.model}
                    onChange={e => updateEquipment(idx, 'model', e.target.value)}
                    placeholder="Modelo"
                    className="rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
                  />
                  <input
                    type="text"
                    value={eq.serial_number}
                    onChange={e => updateEquipment(idx, 'serial_number', e.target.value)}
                    placeholder="Numero de Serie"
                    className="rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={eq.location}
                      onChange={e => updateEquipment(idx, 'location', e.target.value)}
                      placeholder="Localizacao"
                      className="flex-1 rounded-lg border bg-white dark:bg-gray-700 dark:border-gray-600 px-3 py-2 text-sm dark:text-gray-100"
                    />
                    <button
                      type="button"
                      onClick={() => removeEquipment(idx)}
                      className="rounded p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3">
          <Link
            href="/contratos"
            className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar Contrato
          </button>
        </div>
      </form>
    </div>
  )
}
