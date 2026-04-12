'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Building2, Users, ClipboardList, UserCheck, Loader2,
  Plus, X, Save, Copy, Shield, Trash2, Power, Key, Globe, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'

interface Role {
  id: string
  name: string
  is_system: boolean
  is_active: boolean
}

interface UserProfile {
  id: string
  name: string
  email: string
  phone: string | null
  is_active: boolean
  role_id: string
  created_at: string
  roles: { name: string }
}

interface CompanyDetail {
  id: string
  name: string
  slug: string
  subdomain: string | null
  custom_domain: string | null
  logo: string | null
  is_active: boolean
  settings: Record<string, unknown> | null
  created_at: string
  updated_at: string
  _count: { user_profiles: number; service_orders: number; customers: number; roles: number }
  roles: Role[]
  user_profiles: UserProfile[]
}

export default function CompanyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', logo: '' })
  const [saving, setSaving] = useState(false)
  const [showAddUser, setShowAddUser] = useState(false)
  const [runningSetup, setRunningSetup] = useState(false)
  const [domainForm, setDomainForm] = useState({ subdomain: '', custom_domain: '' })
  const [savingDomain, setSavingDomain] = useState(false)

  function loadCompany() {
    setLoading(true)
    fetch(`/api/admin/companies/${companyId}`)
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setCompany(d.data)
          setEditForm({ name: d.data.name, logo: d.data.logo || '' })
          setDomainForm({ subdomain: d.data.subdomain || '', custom_domain: d.data.custom_domain || '' })
        }
      })
      .catch(() => toast.error('Erro ao carregar empresa'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCompany() }, [companyId])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editForm.name, logo: editForm.logo || null }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      toast.success('Empresa atualizada!')
      setEditing(false)
      loadCompany()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive() {
    if (!company) return
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !company.is_active }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      toast.success(company.is_active ? 'Empresa desativada' : 'Empresa reativada')
      loadCompany()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    }
  }

  async function runSetup() {
    setRunningSetup(true)
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/setup`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Setup completo! Bot API Key: ${data.data.botApiKey.slice(0, 12)}...`)
      loadCompany()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setRunningSetup(false)
    }
  }

  async function saveDomain() {
    setSavingDomain(true)
    try {
      const res = await fetch(`/api/admin/companies/${companyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain: domainForm.subdomain || null,
          custom_domain: domainForm.custom_domain || null,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      toast.success('Domínios atualizados!')
      loadCompany()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSavingDomain(false)
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    toast.success('Copiado!')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      </div>
    )
  }

  if (!company) {
    return <p className="text-center text-gray-500 py-20">Empresa não encontrada</p>
  }

  const cards = [
    { label: 'Usuários', value: company._count.user_profiles, icon: Users, color: 'text-blue-400 bg-blue-400/10' },
    { label: 'OS', value: company._count.service_orders, icon: ClipboardList, color: 'text-emerald-400 bg-emerald-400/10' },
    { label: 'Clientes', value: company._count.customers, icon: UserCheck, color: 'text-purple-400 bg-purple-400/10' },
    { label: 'Roles', value: company._count.roles, icon: Shield, color: 'text-amber-400 bg-amber-400/10' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/empresas" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-800">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-lg font-bold text-gray-100 focus:border-amber-500"
                />
                <button onClick={handleSave} disabled={saving} className="rounded bg-amber-500 p-1.5 text-gray-900 hover:bg-amber-400">
                  <Save className="h-4 w-4" />
                </button>
                <button onClick={() => setEditing(false)} className="rounded bg-gray-700 p-1.5 text-gray-400 hover:bg-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h1
                className="text-2xl font-bold text-gray-100 cursor-pointer hover:text-amber-400"
                onClick={() => setEditing(true)}
                title="Clique para editar"
              >
                {company.name}
              </h1>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-gray-500 font-mono">{company.slug}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${company.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                {company.is_active ? 'Ativa' : 'Inativa'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {company.roles.length === 0 && (
            <button
              onClick={runSetup}
              disabled={runningSetup}
              className="flex items-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
            >
              {runningSetup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
              Executar Auto-Setup
            </button>
          )}
          <button
            onClick={toggleActive}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${company.is_active ? 'border border-red-800 text-red-400 hover:bg-red-900/20' : 'border border-emerald-800 text-emerald-400 hover:bg-emerald-900/20'}`}
          >
            <Power className="h-4 w-4" />
            {company.is_active ? 'Desativar' : 'Reativar'}
          </button>
        </div>
      </div>

      {/* Company ID */}
      <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-4 py-2">
        <span className="text-xs text-gray-500">Company ID:</span>
        <code className="text-xs text-amber-400">{company.id}</code>
        <button onClick={() => copyToClipboard(company.id)} className="rounded p-1 text-gray-600 hover:text-gray-400" title="Copiar">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Domain Config */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Globe className="h-4 w-4 text-amber-400" />
            Domínios de Acesso
          </h2>
          <button
            onClick={saveDomain}
            disabled={savingDomain}
            className="flex items-center gap-1 rounded bg-amber-500 px-3 py-1 text-xs font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50"
          >
            {savingDomain ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Salvar
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Subdomínio</label>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={domainForm.subdomain}
                onChange={e => setDomainForm(prev => ({ ...prev, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                placeholder={company.slug}
                className="flex-1 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 font-mono focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">.erp.pontualtech.work</span>
            </div>
            {domainForm.subdomain && (
              <a
                href={`https://${domainForm.subdomain}.erp.pontualtech.work`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
              >
                {domainForm.subdomain}.erp.pontualtech.work
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Domínio Próprio (CNAME)</label>
            <input
              type="text"
              value={domainForm.custom_domain}
              onChange={e => setDomainForm(prev => ({ ...prev, custom_domain: e.target.value.toLowerCase() }))}
              placeholder="erp.minhaempresa.com.br"
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 font-mono focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600"
            />
            {domainForm.custom_domain && (
              <p className="mt-1 text-xs text-gray-500">
                CNAME: <code className="text-amber-400">{domainForm.custom_domain}</code> → <code className="text-gray-400">erp.pontualtech.work</code>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{card.label}</p>
                <div className={`rounded-lg p-2 ${card.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-100">{card.value}</p>
            </div>
          )
        })}
      </div>

      {/* Roles */}
      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-300">Roles / Perfis</h2>
        </div>
        <div className="p-4">
          {company.roles.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma role. Execute o auto-setup para criar as roles padrão.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {company.roles.map(r => (
                <span
                  key={r.id}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${r.is_system ? 'bg-amber-500/10 text-amber-400 border border-amber-800' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}
                >
                  {r.is_system && <Shield className="h-3 w-3" />}
                  {r.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Users */}
      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-300">Usuários ({company.user_profiles.length})</h2>
          {company.roles.length > 0 && (
            <button
              onClick={() => setShowAddUser(true)}
              className="flex items-center gap-1 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-amber-400"
            >
              <Plus className="h-3.5 w-3.5" /> Novo Usuário
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Criado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {company.user_profiles.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Nenhum usuário</td></tr>
              ) : (
                company.user_profiles.map(u => (
                  <tr key={u.id} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 font-medium text-gray-200">{u.name}</td>
                    <td className="px-4 py-3 text-gray-400">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">{u.roles?.name || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {u.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(u.created_at).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddUser && (
        <AddUserModal
          companyId={companyId}
          roles={company.roles}
          onClose={() => setShowAddUser(false)}
          onCreated={() => { setShowAddUser(false); loadCompany() }}
        />
      )}
    </div>
  )
}

function AddUserModal({
  companyId,
  roles,
  onClose,
  onCreated,
}: {
  companyId: string
  roles: Role[]
  onClose: () => void
  onCreated: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', roleId: '', password: '' })
  const [result, setResult] = useState<{ name: string; email: string; generatedPassword?: string; roleName: string } | null>(null)

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.email || !form.roleId) { toast.error('Preencha nome, email e perfil'); return }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro')

      setResult(data.data)
      toast.success(`Usuário ${form.name} criado!`)
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
      <div className="w-full max-w-md rounded-lg bg-gray-900 border border-gray-800 p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">Novo Usuário</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {result ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 p-3">
              <p className="text-sm text-emerald-300">Usuário <strong>{result.name}</strong> criado como <strong>{result.roleName}</strong>!</p>
            </div>
            {result.generatedPassword && (
              <div className="rounded-lg border border-amber-800 bg-amber-900/20 p-3">
                <p className="text-xs text-amber-500 mb-1">Senha gerada automaticamente (copie agora!):</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm text-amber-400">{result.generatedPassword}</code>
                  <button onClick={() => copyToClipboard(result.generatedPassword!)} className="rounded p-1 text-gray-500 hover:text-gray-300">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
            <button onClick={onCreated} className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400">
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Nome *</label>
              <input type="text" value={form.name} onChange={e => update('name', e.target.value)} required placeholder="Nome completo"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={e => update('email', e.target.value)} required placeholder="email@empresa.com"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Telefone</label>
              <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="(11) 99999-0000"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Perfil *</label>
              <select value={form.roleId} onChange={e => update('roleId', e.target.value)} required
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500">
                <option value="">Selecione...</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Senha (opcional)</label>
              <input type="password" value={form.password} onChange={e => update('password', e.target.value)} placeholder="Gerada automaticamente se vazio" minLength={8}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 placeholder:text-gray-600" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="flex-1 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-amber-400 disabled:opacity-50">
                {saving ? 'Criando...' : 'Criar Usuário'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
