'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Search, Pencil, Trash2, Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/use-auth'
import { formatDocument } from '@/lib/utils'

interface Cliente {
  id: string; legal_name: string; trade_name: string | null; person_type: string
  customer_type: string; document_number: string | null; email: string | null
  phone: string | null; mobile: string | null; address_city: string | null; address_state: string | null
  os_count: number; recent_os_count: number; last_os_at: string | null; total_os: number | null
}

const personTypeLabel: Record<string, string> = { FISICA: 'PF', JURIDICA: 'PJ' }

export default function ClientesPage() {
  const router = useRouter()
  const { isAdmin } = useAuth()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  function loadClientes() {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    fetch(`/api/clientes?${params}`)
      .then(r => r.json())
      .then(d => { setClientes(d.data ?? []); setTotalPages(d.totalPages ?? 1) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadClientes(); setSelected(new Set()) }, [search, page])

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    if (selected.size === clientes.length) setSelected(new Set())
    else setSelected(new Set(clientes.map(c => c.id)))
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/clientes/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Cliente excluído'); setDeleteId(null); loadClientes()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setDeleting(false) }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    let ok = 0, fail = 0
    for (const id of selected) {
      try {
        const res = await fetch(`/api/clientes/${id}`, { method: 'DELETE' })
        if (res.ok) ok++; else fail++
      } catch { fail++ }
    }
    toast.success(`${ok} cliente(s) excluído(s)${fail ? `, ${fail} erro(s)` : ''}`)
    setShowBulkDelete(false); setSelected(new Set()); setBulkDeleting(false); loadClientes()
  }

  const clienteToDelete = clientes.find(c => c.id === deleteId)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <div className="flex items-center gap-2">
          {isAdmin && selected.size > 0 && (
            <button type="button" onClick={() => setShowBulkDelete(true)}
              className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
              <Trash2 className="h-4 w-4" /> Excluir {selected.size}
            </button>
          )}
          <Link href="/clientes/novo"
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Novo Cliente
          </Link>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input placeholder="Buscar por nome, documento, telefone..." value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              {isAdmin && (
                <th className="px-3 py-3 w-10">
                  <input type="checkbox" title="Selecionar todos"
                    checked={clientes.length > 0 && selected.size === clientes.length}
                    onChange={toggleAll} className="rounded text-blue-600" />
                </th>
              )}
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Documento</th>
              <th className="px-4 py-3">Celular</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Cidade</th>
              <th className="px-4 py-3 text-center">Qtd OS</th>
              <th className="px-4 py-3">Última OS</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
            ) : clientes.length === 0 ? (
              <tr><td colSpan={isAdmin ? 10 : 9} className="px-4 py-8 text-center text-gray-400">Nenhum cliente encontrado</td></tr>
            ) : (
              clientes.map(c => (
                <tr key={c.id} className={`hover:bg-gray-50 group ${selected.has(c.id) ? 'bg-blue-50' : ''}`}>
                  {isAdmin && (
                    <td className="px-3 py-3">
                      <input type="checkbox" title={`Selecionar ${c.legal_name}`}
                        checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)}
                        className="rounded text-blue-600" />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link href={`/clientes/${c.id}`} className="font-medium text-blue-600 hover:underline">{c.legal_name}</Link>
                    {c.trade_name && <p className="text-xs text-gray-400">{c.trade_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{personTypeLabel[c.person_type] ?? c.person_type}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDocument(c.document_number)}</td>
                  <td className="px-4 py-3 text-gray-700">{c.mobile || c.phone || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.address_city ? `${c.address_city}${c.address_state ? '/' + c.address_state : ''}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-medium text-gray-700">{c.os_count ?? 0}</span>
                    {c.recent_os_count >= 3 && (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                        Recorrente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {c.last_os_at ? new Date(c.last_os_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => router.push(`/clientes/${c.id}`)} title="Ver"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-blue-600"><Eye className="h-4 w-4" /></button>
                      <button type="button" onClick={() => router.push(`/clientes/${c.id}/editar`)} title="Editar"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-amber-600"><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => setDeleteId(c.id)} title="Excluir"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Selection bar */}
      {isAdmin && selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 border border-blue-200 px-4 py-2">
          <span className="text-sm text-blue-700 font-medium">{selected.size} selecionado(s)</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700">Limpar seleção</button>
            <button type="button" onClick={() => setShowBulkDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 font-medium">
              <Trash2 className="h-3.5 w-3.5" /> Excluir selecionados
            </button>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40">Anterior</button>
          <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40">Próxima</button>
        </div>
      )}

      {/* Single delete modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Excluir cliente?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Tem certeza que deseja excluir <strong>{clienteToDelete?.legal_name}</strong>?
            </p>
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

      {/* Bulk delete modal */}
      {showBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowBulkDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-red-600 mb-2">Excluir {selected.size} clientes?</h2>
            <p className="text-sm text-gray-600 mb-2">Esta ação não pode ser desfeita.</p>
            <p className="text-sm text-gray-500 mb-4">
              {clientes.filter(c => selected.has(c.id)).map(c => c.legal_name).join(', ')}
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowBulkDelete(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                {bulkDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {bulkDeleting ? 'Excluindo...' : `Excluir ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
