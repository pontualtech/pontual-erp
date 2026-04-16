'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Search, Pencil, Trash2, Eye, Loader2, MessageCircle, Download, Upload, FileSpreadsheet, FileText, FileDown, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/use-auth'
import { formatDocument } from '@/lib/utils'
import { toTitleCase as tc } from '@/lib/format-text'
import { exportToExcel, exportToCSV, exportToPDF, importFromFile } from '@/lib/export-data'

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
  const [personType, setPersonType] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [recurrenceFilter, setRecurrenceFilter] = useState('')
  const [cities, setCities] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<{ headers: string[], rows: Record<string, string>[], filename: string } | null>(null)
  const [importProgress, setImportProgress] = useState<{ total: number, done: number, errors: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  const exportColumns = [
    { key: 'legal_name', label: 'Nome / Razao Social' },
    { key: 'trade_name', label: 'Nome Fantasia' },
    { key: 'document_number', label: 'CPF/CNPJ' },
    { key: 'phone', label: 'Telefone' },
    { key: 'mobile', label: 'Celular' },
    { key: 'email', label: 'Email' },
    { key: 'city', label: 'Cidade' },
    { key: 'state', label: 'UF' },
    { key: 'address', label: 'Endereco' },
    { key: 'cep', label: 'CEP' },
  ]

  // Map client data to export format (flatten address fields)
  function mapClientForExport(c: Cliente) {
    return {
      legal_name: c.legal_name,
      trade_name: c.trade_name || '',
      document_number: c.document_number || '',
      phone: c.phone || '',
      mobile: c.mobile || '',
      email: c.email || '',
      city: c.address_city || '',
      state: c.address_state || '',
      address: '',
      cep: '',
    }
  }

  async function fetchAllClientsForExport(): Promise<Record<string, any>[]> {
    try {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('limit', '10000')
      if (search) params.set('search', search)
      if (personType) params.set('personType', personType)
      if (cityFilter) params.set('city', cityFilter)
      if (recurrenceFilter) params.set('isRecurrent', recurrenceFilter)
      const res = await fetch(`/api/clientes?${params}`)
      const d = await res.json()
      return (d.data ?? []).map(mapClientForExport)
    } catch {
      toast.error('Erro ao buscar dados para exportação')
      return []
    }
  }

  async function handleExport(format: 'excel' | 'csv' | 'pdf') {
    setShowExportMenu(false)
    toast.info('Preparando exportação...')
    const data = await fetchAllClientsForExport()
    if (data.length === 0) { toast.error('Nenhum dado para exportar'); return }
    const opts = { filename: 'clientes', title: 'Clientes', columns: exportColumns, data }
    if (format === 'excel') exportToExcel(opts)
    else if (format === 'csv') exportToCSV(opts)
    else exportToPDF(opts)
    toast.success(`${data.length} clientes exportados`)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const result = await importFromFile(file)
      if (result.rows.length === 0) { toast.error('Arquivo sem dados'); return }
      setImportPreview(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ler arquivo')
    } finally {
      setImporting(false)
    }
  }

  // Map imported headers to API field names
  function mapImportRow(row: Record<string, string>, headers: string[]): Record<string, any> {
    const headerMap: Record<string, string> = {
      'nome': 'legal_name', 'nome / razao social': 'legal_name', 'razao social': 'legal_name', 'legal_name': 'legal_name',
      'nome fantasia': 'trade_name', 'trade_name': 'trade_name', 'fantasia': 'trade_name',
      'cpf/cnpj': 'document_number', 'cpf': 'document_number', 'cnpj': 'document_number', 'documento': 'document_number', 'document_number': 'document_number',
      'telefone': 'phone', 'phone': 'phone', 'fone': 'phone', 'tel': 'phone',
      'celular': 'mobile', 'mobile': 'mobile', 'cel': 'mobile',
      'email': 'email', 'e-mail': 'email',
      'cidade': 'address_city', 'city': 'address_city', 'address_city': 'address_city',
      'uf': 'address_state', 'estado': 'address_state', 'state': 'address_state', 'address_state': 'address_state',
      'endereco': 'address_street', 'endereço': 'address_street', 'address': 'address_street', 'rua': 'address_street', 'address_street': 'address_street',
      'cep': 'address_zip', 'address_zip': 'address_zip',
    }
    const mapped: Record<string, any> = {}
    for (const [header, value] of Object.entries(row)) {
      const normalized = header.toLowerCase().trim()
      const field = headerMap[normalized]
      if (field && value) mapped[field] = value
    }
    // Ensure required field
    if (!mapped.legal_name) {
      // Try using first non-empty column as name
      const firstVal = Object.values(row).find(v => v && v.trim())
      if (firstVal) mapped.legal_name = firstVal
    }
    return mapped
  }

  async function handleConfirmImport() {
    if (!importPreview) return
    setImportProgress({ total: importPreview.rows.length, done: 0, errors: 0 })
    let done = 0, errors = 0
    for (const row of importPreview.rows) {
      const body = mapImportRow(row, importPreview.headers)
      if (!body.legal_name) { errors++; done++; setImportProgress({ total: importPreview.rows.length, done, errors }); continue }
      try {
        const res = await fetch('/api/clientes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) errors++
      } catch { errors++ }
      done++
      setImportProgress({ total: importPreview.rows.length, done, errors })
    }
    toast.success(`Importação concluída: ${done - errors} sucesso(s), ${errors} erro(s)`)
    setImportPreview(null)
    setImportProgress(null)
    loadClientes()
  }

  function loadClientes() {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')
    if (search) params.set('search', search)
    if (personType) params.set('personType', personType)
    if (cityFilter) params.set('city', cityFilter)
    if (recurrenceFilter) params.set('isRecurrent', recurrenceFilter)
    fetch(`/api/clientes?${params}`)
      .then(r => r.json())
      .then(d => { setClientes(d.data ?? []); setTotalPages(d.totalPages ?? 1) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  // Load unique cities for the filter dropdown
  useEffect(() => {
    fetch('/api/clientes/cities')
      .then(r => r.json())
      .then(d => setCities(d.data ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadClientes(); setSelected(new Set()) }, [search, page, personType, cityFilter, recurrenceFilter])

  // Close export menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    if (showExportMenu) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showExportMenu])

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

          {/* Import button */}
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" aria-label="Importar clientes" title="Importar clientes" />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <Upload className="h-4 w-4" /> {importing ? 'Lendo...' : 'Importar'}
          </button>

          {/* Export dropdown */}
          <div className="relative" ref={exportMenuRef}>
            <button type="button" onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Download className="h-4 w-4" /> Exportar <ChevronDown className="h-3 w-3" />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border bg-white py-1 shadow-lg">
                <button type="button" onClick={() => handleExport('excel')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" /> Excel (.xlsx)
                </button>
                <button type="button" onClick={() => handleExport('csv')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  <FileText className="h-4 w-4 text-blue-600" /> CSV
                </button>
                <button type="button" onClick={() => handleExport('pdf')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                  <FileDown className="h-4 w-4 text-red-600" /> PDF
                </button>
              </div>
            )}
          </div>

          <Link href="/clientes/novo"
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Novo Cliente
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input placeholder="Buscar por nome, documento, telefone..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
        </div>
        <select value={personType} title="Filtrar por tipo de pessoa" onChange={e => { setPersonType(e.target.value); setPage(1) }}
          className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500">
          <option value="">Tipo: Todos</option>
          <option value="PF">Pessoa Fisica</option>
          <option value="PJ">Pessoa Juridica</option>
        </select>
        <select value={cityFilter} title="Filtrar por cidade" onChange={e => { setCityFilter(e.target.value); setPage(1) }}
          className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500">
          <option value="">Cidade: Todas</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={recurrenceFilter} title="Filtrar por recorrencia" onChange={e => { setRecurrenceFilter(e.target.value); setPage(1) }}
          className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500">
          <option value="">Recorrencia: Todos</option>
          <option value="true">Recorrente</option>
          <option value="false">Novo</option>
        </select>
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
                    <Link href={`/clientes/${c.id}`} className="font-medium text-blue-600 hover:underline">{tc(c.legal_name || '')}</Link>
                    {c.trade_name && <p className="text-xs text-gray-400">{c.trade_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{personTypeLabel[c.person_type] ?? c.person_type}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDocument(c.document_number)}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <div className="flex items-center gap-1.5">
                      {c.mobile || c.phone || '—'}
                      {(c.mobile || c.phone) && (
                        <a href={`https://wa.me/${(() => { const d = (c.mobile || c.phone || '').replace(/\D/g, ''); return d.startsWith('55') ? d : '55' + d })()}`}
                          target="_blank" rel="noopener noreferrer" title="WhatsApp"
                          className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-green-500 hover:bg-green-600 transition-colors shrink-0">
                          <MessageCircle className="h-3 w-3 text-white" />
                        </a>
                      )}
                    </div>
                  </td>
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
                    <div className="flex items-center justify-end gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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

      {/* Import preview modal */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { if (!importProgress) setImportPreview(null) }}>
          <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Importar Clientes</h2>
            <p className="text-sm text-gray-500 mb-4">
              Arquivo: <strong>{importPreview.filename}</strong> — {importPreview.rows.length} registro(s) encontrado(s)
            </p>

            {/* Preview table - first 5 rows */}
            <div className="overflow-x-auto rounded-md border mb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-gray-50 text-left font-medium text-gray-500">
                    {importPreview.headers.map(h => (
                      <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {importPreview.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      {importPreview.headers.map(h => (
                        <td key={h} className="px-3 py-1.5 text-gray-700 whitespace-nowrap max-w-[200px] truncate">{row[h] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importPreview.rows.length > 5 && (
              <p className="text-xs text-gray-400 mb-4">...e mais {importPreview.rows.length - 5} registro(s)</p>
            )}

            {/* Progress bar */}
            {importProgress && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                  <span>Importando... {importProgress.done}/{importProgress.total}</span>
                  {importProgress.errors > 0 && <span className="text-red-500">{importProgress.errors} erro(s)</span>}
                </div>
                <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }} />
                </div>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => { setImportPreview(null); setImportProgress(null) }} disabled={!!importProgress && importProgress.done < importProgress.total}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={handleConfirmImport} disabled={!!importProgress}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {importProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importProgress ? 'Importando...' : `Importar ${importPreview.rows.length} registro(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
