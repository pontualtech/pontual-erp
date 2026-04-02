'use client'

import { useEffect, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Loader2, X, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDocument } from '@/lib/utils'
import Link from 'next/link'

interface Supplier {
  id: string
  name: string
  cnpj: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  delivery_days: number | null
  address: string | null
  notes: string | null
  is_active: boolean
  created_at: string
}

interface SupplierForm {
  name: string
  cnpj: string
  contact_name: string
  phone: string
  email: string
  delivery_days: string
  address: string
  notes: string
}

const emptyForm: SupplierForm = {
  name: '', cnpj: '', contact_name: '', phone: '', email: '',
  delivery_days: '', address: '', notes: '',
}

export default function FornecedoresPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SupplierForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function loadSuppliers() {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    fetch(`/api/suppliers?${params}`)
      .then(r => r.json())
      .then(d => setSuppliers(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar fornecedores'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadSuppliers() }, [search])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function openEdit(s: Supplier) {
    setEditingId(s.id)
    setForm({
      name: s.name,
      cnpj: s.cnpj ?? '',
      contact_name: s.contact_name ?? '',
      phone: s.phone ?? '',
      email: s.email ?? '',
      delivery_days: s.delivery_days?.toString() ?? '',
      address: s.address ?? '',
      notes: s.notes ?? '',
    })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        cnpj: form.cnpj.trim() || null,
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        delivery_days: form.delivery_days ? parseInt(form.delivery_days, 10) : null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      }

      const url = editingId ? `/api/suppliers/${editingId}` : '/api/suppliers'
      const method = editingId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar fornecedor')

      toast.success(editingId ? 'Fornecedor atualizado!' : 'Fornecedor criado!')
      setShowModal(false)
      loadSuppliers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/suppliers/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao excluir')
      }
      toast.success('Fornecedor excluído!')
      setDeleteId(null)
      loadSuppliers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fornecedores</h1>
          <p className="text-sm text-gray-500">
            <Link href="/produtos" className="text-blue-600 hover:underline">Estoque</Link> / Fornecedores
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Novo Fornecedor
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          placeholder="Buscar por nome, CNPJ, email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CNPJ</th>
              <th className="px-4 py-3">Contato</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Prazo Entrega</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin inline mr-2" />Carregando...
              </td></tr>
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                <Building2 className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                Nenhum fornecedor encontrado
              </td></tr>
            ) : (
              suppliers.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{formatDocument(s.cnpj)}</td>
                  <td className="px-4 py-3 text-gray-500">{s.contact_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{s.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {s.delivery_days ? `${s.delivery_days} dias` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => openEdit(s)} title="Editar"
                        className="rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setDeleteId(s.id)} title="Excluir"
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Editar Fornecedor' : 'Novo Fornecedor'}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="rounded p-1 hover:bg-gray-100">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Nome *</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm" placeholder="Nome do fornecedor" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">CNPJ</label>
                  <input type="text" value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm" placeholder="00.000.000/0000-00" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Contato</label>
                  <input type="text" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm" placeholder="Nome do contato" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Telefone</label>
                  <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm" placeholder="(11) 99999-9999" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm" placeholder="contato@fornecedor.com" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Prazo de Entrega (dias)</label>
                  <input type="number" min="0" value={form.delivery_days} onChange={e => setForm({ ...form, delivery_days: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md text-sm" placeholder="Ex: 7" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Endereço</label>
                <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm" placeholder="Endereço completo" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Observações</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2} className="w-full px-3 py-2 border rounded-md text-sm resize-none" placeholder="Notas adicionais..." />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Criar Fornecedor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-red-600 mb-2">Excluir Fornecedor?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Esta ação não pode ser desfeita. Todos os dados do fornecedor serão removidos.
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
