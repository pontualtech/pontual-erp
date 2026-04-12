'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Search, X, Loader2, Building2, CheckCircle, AlertCircle, Copy } from 'lucide-react'
import { toast } from 'sonner'

interface Company {
  id: string
  name: string
  slug: string
  logo: string | null
  is_active: boolean
  created_at: string
  _count: { user_profiles: number; service_orders: number; customers: number }
}

export default function EmpresasPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const loadCompanies = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    fetch(`/api/admin/companies?${params}`)
      .then(r => r.json())
      .then(d => setCompanies(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar empresas'))
      .finally(() => setLoading(false))
  }, [search])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Empresas</h1>
          <p className="text-sm text-gray-500">Gerencie todas as empresas da plataforma</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 transition-colors"
        >
          <Plus className="h-4 w-4" /> Nova Empresa
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
        <input
          placeholder="Buscar por nome ou slug..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-md border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-gray-200 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3 text-right">Usuários</th>
              <th className="px-4 py-3 text-right">OS</th>
              <th className="px-4 py-3 text-right">Clientes</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Criada</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-gray-500 mx-auto" /></td></tr>
            ) : companies.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Nenhuma empresa encontrada</td></tr>
            ) : (
              companies.map(c => (
                <tr key={c.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/empresas/${c.id}`} className="font-medium text-gray-200 hover:text-amber-400">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.slug}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{c._count.user_profiles}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{c._count.service_orders}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{c._count.customers}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${c.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {c.is_active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateCompanyModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadCompanies() }}
        />
      )}
    </div>
  )
}

function CreateCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<'form' | 'setup' | 'done'>('form')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '', logo: '' })
  const [createdCompany, setCreatedCompany] = useState<{ id: string; name: string; slug: string } | null>(null)
  const [setupResult, setSetupResult] = useState<{
    botApiKey: string
    roles: { id: string; name: string }[]
    statuses: number
    equipamentos: number
    marcas: number
  } | null>(null)

  function autoSlug(name: string) {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  function updateName(name: string) {
    setForm(prev => ({ ...prev, name, slug: autoSlug(name) }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.slug) { toast.error('Nome e slug são obrigatórios'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar')

      setCreatedCompany(data.data)
      toast.success(`Empresa ${form.name} criada!`)
      setStep('setup')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetup() {
    if (!createdCompany) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/companies/${createdCompany.id}/setup`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro no setup')

      setSetupResult(data.data)
      toast.success('Setup completo!')
      setStep('done')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    toast.success('Copiado!')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-gray-900 border border-gray-800 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-amber-400" />
            {step === 'form' && 'Nova Empresa'}
            {step === 'setup' && 'Auto-Setup'}
            {step === 'done' && 'Setup Completo'}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step 1: Form */}
        {step === 'form' && (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome da Empresa *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => updateName(e.target.value)}
                placeholder="Ex: Imprimitech Assistência Técnica"
                required
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Slug (URL) *</label>
              <input
                type="text"
                value={form.slug}
                onChange={e => setForm(prev => ({ ...prev, slug: e.target.value }))}
                placeholder="imprimitech"
                required
                pattern="^[a-z0-9-]+$"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 font-mono focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600"
              />
              <p className="mt-1 text-xs text-gray-600">Apenas letras minúsculas, números e hífens</p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Logo URL (opcional)</label>
              <input
                type="url"
                value={form.logo}
                onChange={e => setForm(prev => ({ ...prev, logo: e.target.value }))}
                placeholder="https://..."
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="flex-1 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50">
                {saving ? 'Criando...' : 'Criar Empresa'}
              </button>
            </div>
          </form>
        )}

        {/* Step 2: Setup */}
        {step === 'setup' && createdCompany && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-3 flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-emerald-300">Empresa <strong>{createdCompany.name}</strong> criada com sucesso!</p>
                <p className="text-xs text-emerald-500 mt-1">ID: {createdCompany.id}</p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-800 bg-amber-900/20 p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-amber-300">O auto-setup vai criar:</p>
                <ul className="mt-1 text-xs text-amber-500 space-y-0.5">
                  <li>• 6 Roles (Admin, Atendente, Técnico, Motorista, Financeiro, Suporte)</li>
                  <li>• 10 Status de OS (Aberta → Entregue/Cancelada)</li>
                  <li>• Equipamentos, marcas e modelos padrão</li>
                  <li>• Bot API Key para integração</li>
                  <li>• Número inicial de OS: 1000</li>
                </ul>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={onCreated} className="flex-1 rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
                Pular Setup
              </button>
              <button onClick={handleSetup} disabled={saving} className="flex-1 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Executar Auto-Setup'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 'done' && setupResult && createdCompany && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-3">
              <p className="text-sm text-emerald-300 font-medium">Setup completo!</p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Roles criadas:</span>
                <span className="text-gray-200">{setupResult.roles.length}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Status de OS:</span>
                <span className="text-gray-200">{setupResult.statuses}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Equipamentos:</span>
                <span className="text-gray-200">{setupResult.equipamentos}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Marcas:</span>
                <span className="text-gray-200">{setupResult.marcas}</span>
              </div>
            </div>

            {/* Bot API Key */}
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
              <p className="text-xs text-gray-500 mb-1">Bot API Key (copie e guarde!)</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-amber-400 break-all">{setupResult.botApiKey}</code>
                <button
                  onClick={() => copyToClipboard(setupResult.botApiKey)}
                  className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-300 shrink-0"
                  title="Copiar"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Company ID */}
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
              <p className="text-xs text-gray-500 mb-1">Company ID</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-amber-400 break-all">{createdCompany.id}</code>
                <button
                  onClick={() => copyToClipboard(createdCompany.id)}
                  className="rounded p-1 text-gray-500 hover:bg-gray-700 hover:text-gray-300 shrink-0"
                  title="Copiar"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            <button
              onClick={onCreated}
              className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400"
            >
              Concluir
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
