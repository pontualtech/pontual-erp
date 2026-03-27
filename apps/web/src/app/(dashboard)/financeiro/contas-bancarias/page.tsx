'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X, Loader2, ArrowLeft, Search, Landmark } from 'lucide-react'
import Link from 'next/link'

type AccountType = 'CHECKING' | 'SAVINGS' | 'CASH'

interface ContaBancaria {
  id: string
  name: string
  bank_name: string | null
  agency: string | null
  account_number: string | null
  account_type: AccountType
  initial_balance: number
  is_active: boolean
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: 'Corrente',
  SAVINGS: 'Poupanca',
  CASH: 'Caixa',
}

const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  CHECKING: 'bg-blue-100 text-blue-700',
  SAVINGS: 'bg-purple-100 text-purple-700',
  CASH: 'bg-amber-100 text-amber-700',
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function parseCurrency(value: string): number {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(',', '.')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.round(num * 100)
}

export default function ContasBancariasPage() {
  const [items, setItems] = useState<ContaBancaria[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<ContaBancaria | null>(null)
  const [formName, setFormName] = useState('')
  const [formBankName, setFormBankName] = useState('')
  const [formAgency, setFormAgency] = useState('')
  const [formAccountNumber, setFormAccountNumber] = useState('')
  const [formAccountType, setFormAccountType] = useState<AccountType>('CHECKING')
  const [formBalance, setFormBalance] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/financeiro/contas-bancarias')
      .then(r => r.json())
      .then(d => setItems(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null); setFormName(''); setFormBankName(''); setFormAgency('')
    setFormAccountNumber(''); setFormAccountType('CHECKING'); setFormBalance(''); setFormActive(true)
    setShowModal(true)
  }
  function openEdit(c: ContaBancaria) {
    setEditing(c); setFormName(c.name); setFormBankName(c.bank_name ?? '')
    setFormAgency(c.agency ?? ''); setFormAccountNumber(c.account_number ?? '')
    setFormAccountType(c.account_type); setFormBalance((c.initial_balance / 100).toFixed(2).replace('.', ','))
    setFormActive(c.is_active); setShowModal(true)
  }

  async function handleSave() {
    if (!formName.trim()) { toast.error('Nome é obrigatório'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/financeiro/contas-bancarias/${editing.id}` : '/api/financeiro/contas-bancarias'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          bank_name: formBankName.trim() || null,
          agency: formAgency.trim() || null,
          account_number: formAccountNumber.trim() || null,
          account_type: formAccountType,
          initial_balance: parseCurrency(formBalance),
          is_active: formActive,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success(editing ? 'Conta atualizada!' : 'Conta criada!')
      setShowModal(false); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/financeiro/contas-bancarias/${deleteId}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Conta excluída'); setDeleteId(null); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.bank_name && i.bank_name.toLowerCase().includes(search.toLowerCase()))
  )
  const toDelete = items.find(i => i.id === deleteId)

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/financeiro" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
          <h1 className="text-2xl font-bold text-gray-900">Contas Bancarias</h1>
        </div>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Nova Conta
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome ou banco..."
          className="w-full pl-9 pr-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-sm" />
      </div>

      {loading ? <div className="py-8 text-center text-gray-400">Carregando...</div> : (
        <div className="space-y-4">
          {filtered.length > 0 ? (
            <div className="rounded-lg border bg-white overflow-hidden">
              <div className="divide-y">
                {filtered.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 group">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0 h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center">
                        <Landmark className="h-4 w-4 text-gray-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACCOUNT_TYPE_COLORS[c.account_type]}`}>
                            {ACCOUNT_TYPE_LABELS[c.account_type]}
                          </span>
                          {!c.is_active && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500">Inativo</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                          {c.bank_name && <span>{c.bank_name}</span>}
                          {c.agency && c.account_number && (
                            <span>Ag {c.agency} / CC {c.account_number}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{formatCurrency(c.initial_balance)}</span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button type="button" onClick={() => openEdit(c)} title="Editar"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-amber-600"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setDeleteId(c.id)} title="Excluir"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-gray-400">
              {search ? 'Nenhuma conta encontrada' : 'Nenhuma conta bancaria cadastrada'}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editing ? 'Editar Conta' : 'Nova Conta Bancaria'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome da conta *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: Conta Principal, Caixa da Loja..."
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Banco</label>
                <input type="text" value={formBankName} onChange={e => setFormBankName(e.target.value)}
                  placeholder="Ex: Banco do Brasil, Itau, Nubank..."
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agencia</label>
                  <input type="text" value={formAgency} onChange={e => setFormAgency(e.target.value)}
                    placeholder="0001"
                    className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Conta</label>
                  <input type="text" value={formAccountNumber} onChange={e => setFormAccountNumber(e.target.value)}
                    placeholder="12345-6"
                    className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de conta</label>
                <select value={formAccountType} onChange={e => setFormAccountType(e.target.value as AccountType)}
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white">
                  <option value="CHECKING">Corrente</option>
                  <option value="SAVINGS">Poupanca</option>
                  <option value="CASH">Caixa</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Saldo inicial (R$)</label>
                <input type="text" value={formBalance} onChange={e => setFormBalance(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="formActive" checked={formActive} onChange={e => setFormActive(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <label htmlFor="formActive" className="text-sm font-medium text-gray-700">Ativo</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Excluir conta?</h2>
            <p className="text-sm text-gray-600 mb-4">Tem certeza que deseja excluir <strong>{toDelete?.name}</strong>?</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
