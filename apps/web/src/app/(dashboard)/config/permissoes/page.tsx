'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Shield, Plus, Pencil, Trash2, Users, X, Loader2, Check } from 'lucide-react'

interface Role {
  id: string; name: string; description: string | null
  isSystem: boolean; isActive: boolean; userCount: number; permissionCount: number
}

interface PermItem { id: string; action: string; description: string | null; granted: boolean }
type PermMap = Record<string, PermItem[]>

const MODULE_LABELS: Record<string, string> = {
  core: 'Sistema', dashboard: 'Dashboard', os: 'Ordens de Serviço', clientes: 'Clientes',
  estoque: 'Produtos/Estoque', financeiro: 'Financeiro', fiscal: 'Fiscal', config: 'Configurações',
}
const ACTION_LABELS: Record<string, string> = {
  view: 'Visualizar', read: 'Visualizar', create: 'Criar', edit: 'Editar', delete: 'Excluir',
}

export default function PermissoesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRole, setSelectedRole] = useState<string | null>(null)
  const [permMap, setPermMap] = useState<PermMap>({})
  const [permLoading, setPermLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Role CRUD
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [roleName, setRoleName] = useState('')
  const [roleDesc, setRoleDesc] = useState('')
  const [roleSaving, setRoleSaving] = useState(false)
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  function loadRoles() {
    setLoading(true)
    fetch('/api/roles').then(r => r.json())
      .then(d => setRoles(d.data ?? []))
      .catch(() => toast.error('Erro ao carregar perfis'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadRoles() }, [])

  function loadPermissions(roleId: string) {
    setSelectedRole(roleId)
    setPermLoading(true)
    fetch(`/api/roles/${roleId}/permissions`).then(r => r.json())
      .then(d => setPermMap(d.data?.permissions ?? {}))
      .catch(() => toast.error('Erro ao carregar permissões'))
      .finally(() => setPermLoading(false))
  }

  function togglePerm(module: string, idx: number) {
    setPermMap(prev => {
      const copy = { ...prev }
      copy[module] = [...copy[module]]
      copy[module][idx] = { ...copy[module][idx], granted: !copy[module][idx].granted }
      return copy
    })
  }

  function toggleModule(module: string, grant: boolean) {
    setPermMap(prev => {
      const copy = { ...prev }
      copy[module] = copy[module].map(p => ({ ...p, granted: grant }))
      return copy
    })
  }

  async function savePermissions() {
    if (!selectedRole) return
    setSaving(true)
    try {
      const permissions: { permissionId: string; granted: boolean }[] = []
      for (const perms of Object.values(permMap)) {
        for (const p of perms) {
          permissions.push({ permissionId: p.id, granted: p.granted })
        }
      }
      const res = await fetch(`/api/roles/${selectedRole}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Permissões salvas!')
      loadRoles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  // Role CRUD handlers
  function openCreateRole() {
    setEditingRole(null); setRoleName(''); setRoleDesc(''); setShowRoleModal(true)
  }
  function openEditRole(r: Role) {
    setEditingRole(r); setRoleName(r.name); setRoleDesc(r.description || ''); setShowRoleModal(true)
  }

  async function handleSaveRole() {
    if (!roleName.trim()) { toast.error('Nome é obrigatório'); return }
    setRoleSaving(true)
    try {
      const url = editingRole ? `/api/roles/${editingRole.id}` : '/api/roles'
      const method = editingRole ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roleName.trim(), description: roleDesc || null }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success(editingRole ? 'Perfil atualizado!' : 'Perfil criado!')
      setShowRoleModal(false); loadRoles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setRoleSaving(false) }
  }

  async function handleDeleteRole() {
    if (!deleteRoleId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/roles/${deleteRoleId}`, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro')
      toast.success('Perfil excluído')
      setDeleteRoleId(null)
      if (selectedRole === deleteRoleId) { setSelectedRole(null); setPermMap({}) }
      loadRoles()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally { setDeleting(false) }
  }

  const selectedRoleObj = roles.find(r => r.id === selectedRole)
  const roleToDelete = roles.find(r => r.id === deleteRoleId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Perfis e Permissões</h1>
          <p className="text-sm text-gray-500 mt-1">Gerencie os perfis de acesso e suas permissões</p>
        </div>
        <button type="button" onClick={openCreateRole}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Novo Perfil
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Roles list */}
        <div className="lg:col-span-1 space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase">Perfis</h2>
          {loading ? (
            <div className="text-center py-8 text-gray-400">Carregando...</div>
          ) : (
            <div className="space-y-1">
              {roles.map(r => (
                <div key={r.id}
                  className={`rounded-lg border p-3 cursor-pointer transition-colors group ${
                    selectedRole === r.id ? 'border-blue-500 bg-blue-50' : 'hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => loadPermissions(r.id)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className={`h-4 w-4 ${selectedRole === r.id ? 'text-blue-600' : 'text-gray-400'}`} />
                      <span className="font-medium text-gray-900">{r.name}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button type="button" onClick={e => { e.stopPropagation(); openEditRole(r) }} title="Editar"
                        className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-amber-600">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {r.name.toLowerCase() !== 'admin' && (
                        <button type="button" onClick={e => { e.stopPropagation(); setDeleteRoleId(r.id) }} title="Excluir"
                          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {r.userCount} usuários</span>
                    <span>{r.permissionCount} permissões</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Permissions matrix */}
        <div className="lg:col-span-2">
          {!selectedRole ? (
            <div className="rounded-lg border bg-white p-12 text-center text-gray-400">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Selecione um perfil</p>
              <p className="text-sm mt-1">Clique em um perfil à esquerda para gerenciar suas permissões</p>
            </div>
          ) : selectedRoleObj?.name.toLowerCase() === 'admin' ? (
            <div className="rounded-lg border bg-green-50 border-green-200 p-8 text-center">
              <Check className="h-10 w-10 mx-auto mb-2 text-green-600" />
              <p className="font-semibold text-green-800">Admin tem acesso total</p>
              <p className="text-sm text-green-600 mt-1">O perfil Admin possui todas as permissões automaticamente</p>
            </div>
          ) : permLoading ? (
            <div className="text-center py-12 text-gray-400">Carregando permissões...</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">
                  Permissões de <span className="text-blue-600">{selectedRoleObj?.name}</span>
                </h2>
                <button type="button" onClick={savePermissions} disabled={saving}
                  className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? 'Salvando...' : 'Salvar Permissões'}
                </button>
              </div>

              <div className="space-y-3">
                {Object.entries(permMap).map(([module, perms]) => {
                  const allGranted = perms.every(p => p.granted)
                  const someGranted = perms.some(p => p.granted)
                  return (
                    <div key={module} className="rounded-lg border bg-white overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b">
                        <span className="font-medium text-gray-900 text-sm">{MODULE_LABELS[module] || module}</span>
                        <button type="button" onClick={() => toggleModule(module, !allGranted)}
                          className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ${
                            allGranted ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700'
                            : someGranted ? 'bg-amber-100 text-amber-700 hover:bg-green-100 hover:text-green-700'
                            : 'bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-700'
                          }`}>
                          {allGranted ? 'Tudo ativo' : someGranted ? 'Parcial' : 'Tudo inativo'}
                        </button>
                      </div>
                      <div className="divide-y">
                        {perms.map((p, idx) => (
                          <label key={p.id} className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 cursor-pointer">
                            <div>
                              <span className="text-sm text-gray-700">{ACTION_LABELS[p.action] || p.action}</span>
                              {p.description && <span className="text-xs text-gray-400 ml-2">— {p.description}</span>}
                            </div>
                            <div className="relative">
                              <input type="checkbox" checked={p.granted} onChange={() => togglePerm(module, idx)}
                                title={p.action} className="sr-only peer" />
                              <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors" />
                              <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit role modal */}
      {showRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowRoleModal(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{editingRole ? 'Editar Perfil' : 'Novo Perfil'}</h2>
              <button type="button" onClick={() => setShowRoleModal(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do perfil *</label>
                <input type="text" value={roleName} onChange={e => setRoleName(e.target.value)}
                  placeholder="Ex: Supervisor, Gerente..." autoFocus
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <input type="text" value={roleDesc} onChange={e => setRoleDesc(e.target.value)}
                  placeholder="Descrição das responsabilidades..."
                  className="w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowRoleModal(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleSaveRole} disabled={roleSaving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {roleSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {roleSaving ? 'Salvando...' : editingRole ? 'Salvar' : 'Criar Perfil'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete role modal */}
      {deleteRoleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteRoleId(null)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Excluir perfil?</h2>
            <p className="text-sm text-gray-600 mb-4">
              Tem certeza que deseja excluir <strong>{roleToDelete?.name}</strong>?
              {(roleToDelete?.userCount ?? 0) > 0 && (
                <span className="block mt-1 text-red-600">Este perfil tem {roleToDelete?.userCount} usuários vinculados.</span>
              )}
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDeleteRoleId(null)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleDeleteRole} disabled={deleting}
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
