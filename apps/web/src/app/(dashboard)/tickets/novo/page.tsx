'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Search } from 'lucide-react'
import Link from 'next/link'

interface User { id: string; name: string }
interface Cliente { id: string; legal_name: string; trade_name: string | null }
interface OS { id: string; os_number: number; equipment_type: string | null }

export default function NovoTicketPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<User[]>([])

  // Customer search
  const [searchCliente, setSearchCliente] = useState('')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)

  // OS search
  const [searchOS, setSearchOS] = useState('')
  const [osList, setOsList] = useState<OS[]>([])
  const [showOSDropdown, setShowOSDropdown] = useState(false)

  const [form, setForm] = useState({
    subject: '',
    description: '',
    priority: 'NORMAL',
    category: '',
    assigned_to: '',
    customer_id: '',
    service_order_id: '',
    source: 'INTERNO',
  })

  // Load users for assignment
  useEffect(() => {
    fetch('/api/users?limit=100')
      .then(r => r.json())
      .then(d => setUsers(d.data || []))
      .catch(() => {})
  }, [])

  // Search customers
  useEffect(() => {
    if (searchCliente.length < 2) { setClientes([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/clientes?search=${encodeURIComponent(searchCliente)}&limit=10`)
        .then(r => r.json())
        .then(d => { setClientes(d.data || []); setShowClienteDropdown(true) })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [searchCliente])

  // Search OS
  useEffect(() => {
    if (searchOS.length < 1) { setOsList([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/os?search=${encodeURIComponent(searchOS)}&limit=10`)
        .then(r => r.json())
        .then(d => { setOsList(d.data || []); setShowOSDropdown(true) })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [searchOS])

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const selectedCliente = clientes.find(c => c.id === form.customer_id)
  const selectedOS = osList.find(o => o.id === form.service_order_id)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.subject.trim()) { toast.error('Informe o assunto'); return }

    setLoading(true)
    try {
      const payload: any = {
        subject: form.subject,
        description: form.description,
        priority: form.priority,
        source: form.source,
      }
      if (form.category) payload.category = form.category
      if (form.assigned_to) payload.assigned_to = form.assigned_to
      if (form.customer_id) payload.customer_id = form.customer_id
      if (form.service_order_id) payload.service_order_id = form.service_order_id

      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar ticket')

      toast.success(`Ticket #${data.data.ticket_number} criado!`)
      router.push(`/tickets/${data.data.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar ticket')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/tickets" className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Novo Ticket</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Subject */}
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assunto *</label>
            <input
              value={form.subject}
              onChange={e => updateForm('subject', e.target.value)}
              placeholder="Descreva brevemente o assunto..."
              className="w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descricao</label>
            <textarea
              value={form.description}
              onChange={e => updateForm('description', e.target.value)}
              placeholder="Detalhes adicionais..."
              rows={4}
              className="w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Priority, Category, Assign */}
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prioridade</label>
              <select
                value={form.priority}
                onChange={e => updateForm('priority', e.target.value)}
                className="w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="BAIXA">Baixa</option>
                <option value="NORMAL">Normal</option>
                <option value="ALTA">Alta</option>
                <option value="URGENTE">Urgente</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria</label>
              <select
                value={form.category}
                onChange={e => updateForm('category', e.target.value)}
                className="w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="">Selecionar...</option>
                <option value="Suporte">Suporte</option>
                <option value="Duvida">Duvida</option>
                <option value="Reclamacao">Reclamacao</option>
                <option value="Sugestao">Sugestao</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Responsavel</label>
            <select
              value={form.assigned_to}
              onChange={e => updateForm('assigned_to', e.target.value)}
              className="w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="">Nao atribuido</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Optional links */}
        <div className="rounded-lg border bg-white dark:bg-gray-800 dark:border-gray-700 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Vinculos (opcional)</h2>

          {/* Customer */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cliente</label>
            {form.customer_id && selectedCliente ? (
              <div className="flex items-center gap-2 rounded-md border bg-blue-50 dark:bg-blue-900/30 dark:border-blue-800 px-3 py-2">
                <span className="text-sm text-blue-700 dark:text-blue-400 font-medium">{selectedCliente.legal_name}</span>
                <button
                  type="button"
                  onClick={() => { updateForm('customer_id', ''); setSearchCliente('') }}
                  className="ml-auto text-xs text-gray-400 hover:text-red-500"
                >
                  Remover
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  value={searchCliente}
                  onChange={e => setSearchCliente(e.target.value)}
                  onFocus={() => clientes.length > 0 && setShowClienteDropdown(true)}
                  placeholder="Buscar cliente..."
                  className="w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                />
                {showClienteDropdown && clientes.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-lg max-h-40 overflow-y-auto">
                    {clientes.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { updateForm('customer_id', c.id); setShowClienteDropdown(false) }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200"
                      >
                        {c.legal_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* OS */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ordem de Servico</label>
            {form.service_order_id && selectedOS ? (
              <div className="flex items-center gap-2 rounded-md border bg-blue-50 dark:bg-blue-900/30 dark:border-blue-800 px-3 py-2">
                <span className="text-sm text-blue-700 dark:text-blue-400 font-medium">
                  OS-{String(selectedOS.os_number).padStart(4, '0')} {selectedOS.equipment_type ? `- ${selectedOS.equipment_type}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => { updateForm('service_order_id', ''); setSearchOS('') }}
                  className="ml-auto text-xs text-gray-400 hover:text-red-500"
                >
                  Remover
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  value={searchOS}
                  onChange={e => setSearchOS(e.target.value)}
                  onFocus={() => osList.length > 0 && setShowOSDropdown(true)}
                  placeholder="Buscar OS por numero..."
                  className="w-full rounded-md border bg-white dark:bg-gray-900 dark:border-gray-600 dark:text-gray-100 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                />
                {showOSDropdown && osList.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-white dark:bg-gray-800 dark:border-gray-700 shadow-lg max-h-40 overflow-y-auto">
                    {osList.map(os => (
                      <button
                        key={os.id}
                        type="button"
                        onClick={() => { updateForm('service_order_id', os.id); setShowOSDropdown(false) }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200"
                      >
                        OS-{String(os.os_number).padStart(4, '0')} {os.equipment_type ? `- ${os.equipment_type}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Link
            href="/tickets"
            className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Criando...' : 'Criar Ticket'}
          </button>
        </div>
      </form>

      {/* Close dropdowns on outside click */}
      {(showClienteDropdown || showOSDropdown) && (
        <div className="fixed inset-0 z-0" onClick={() => { setShowClienteDropdown(false); setShowOSDropdown(false) }} />
      )}
    </div>
  )
}
