'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/use-auth'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Loader2, Save, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const COLUMNS = [
  { key: 'os_number', label: 'N\u00ba' },
  { key: 'created_at', label: 'Data' },
  { key: 'customer', label: 'Cliente' },
  { key: 'equipment_type', label: 'Equipamento' },
  { key: 'status', label: 'Status' },
  { key: 'total_cost', label: 'Valor' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'technician', label: 'T\u00e9cnico' },
  { key: 'priority', label: 'Prioridade' },
]

const ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'atendente', label: 'Atendente' },
  { key: 'tecnico', label: 'T\u00e9cnico' },
  { key: 'motorista', label: 'Motorista' },
  { key: 'financeiro', label: 'Financeiro' },
]

const DEFAULT_HIDDEN: Record<string, string[]> = {
  admin: [],
  atendente: ['total_cost', 'financeiro'],
  tecnico: ['total_cost', 'financeiro'],
  motorista: ['total_cost', 'financeiro'],
  financeiro: [],
}

const DEFAULT_OWN_ONLY: Record<string, boolean> = {
  admin: false,
  atendente: false,
  tecnico: true,
  motorista: true,
  financeiro: false,
}

interface RoleConfig {
  columns: string[]
  own_only: boolean
}

export default function VisibilidadeOSPage() {
  const { isAdmin } = useAuth()
  const [configs, setConfigs] = useState<Record<string, RoleConfig>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadConfigs()
  }, [])

  async function loadConfigs() {
    setLoading(true)
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      const grouped = data.data ?? {}
      const osGroup = grouped['os_visibility'] ?? {}

      const loaded: Record<string, RoleConfig> = {}
      for (const role of ROLES) {
        const key = `os_visibility.${role.key}`
        if (osGroup[key]) {
          try {
            loaded[role.key] = JSON.parse(osGroup[key].value)
          } catch {
            loaded[role.key] = getDefault(role.key)
          }
        } else {
          loaded[role.key] = getDefault(role.key)
        }
      }
      setConfigs(loaded)
    } catch {
      // Use defaults
      const defaults: Record<string, RoleConfig> = {}
      for (const role of ROLES) {
        defaults[role.key] = getDefault(role.key)
      }
      setConfigs(defaults)
    } finally {
      setLoading(false)
    }
  }

  function getDefault(roleName: string): RoleConfig {
    const hidden = DEFAULT_HIDDEN[roleName] ?? ['total_cost', 'financeiro']
    return {
      columns: COLUMNS.map(c => c.key).filter(k => !hidden.includes(k)),
      own_only: DEFAULT_OWN_ONLY[roleName] ?? false,
    }
  }

  function toggleColumn(role: string, colKey: string) {
    if (role === 'admin') return // Admin always sees all
    setConfigs(prev => {
      const cfg = { ...prev[role] }
      if (cfg.columns.includes(colKey)) {
        cfg.columns = cfg.columns.filter(c => c !== colKey)
      } else {
        cfg.columns = [...cfg.columns, colKey]
      }
      return { ...prev, [role]: cfg }
    })
  }

  function toggleOwnOnly(role: string) {
    if (role === 'admin') return
    setConfigs(prev => {
      const cfg = { ...prev[role] }
      cfg.own_only = !cfg.own_only
      return { ...prev, [role]: cfg }
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const settings = ROLES
        .filter(r => r.key !== 'admin') // Don't save admin config
        .map(role => ({
          key: `os_visibility.${role.key}`,
          value: JSON.stringify(configs[role.key]),
          type: 'json' as const,
          group: 'os_visibility',
        }))

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })

      if (!res.ok) throw new Error('Erro ao salvar')
      toast.success('Visibilidade salva com sucesso')
    } catch {
      toast.error('Erro ao salvar configuracoes')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500">Acesso restrito a administradores.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-md p-1.5 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Visibilidade de OS</h1>
            <p className="text-sm text-gray-500 mt-0.5">Configure quais colunas e filtros cada perfil pode ver na lista de OS</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar
        </button>
      </div>

      {/* Matrix grid */}
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Coluna</th>
              {ROLES.map(role => (
                <th key={role.key} className="px-4 py-3 text-center text-xs font-semibold uppercase text-gray-500">
                  {role.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {COLUMNS.map(col => (
              <tr key={col.key} className="hover:bg-gray-50/50">
                <td className="px-4 py-3 font-medium text-gray-700">{col.label}</td>
                {ROLES.map(role => {
                  const isAdminRole = role.key === 'admin'
                  const checked = isAdminRole || (configs[role.key]?.columns ?? []).includes(col.key)
                  return (
                    <td key={role.key} className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isAdminRole}
                        onChange={() => toggleColumn(role.key, col.key)}
                        title={isAdminRole ? 'Admin sempre ve tudo' : `${col.label} para ${role.label}`}
                        className={cn(
                          'h-4 w-4 rounded text-blue-600 focus:ring-blue-500',
                          isAdminRole && 'opacity-50 cursor-not-allowed'
                        )}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}

            {/* Own only row */}
            <tr className="bg-amber-50/50 border-t-2">
              <td className="px-4 py-3 font-medium text-gray-700">
                <div>
                  <span>Ver apenas suas OS</span>
                  <p className="text-xs text-gray-400 font-normal mt-0.5">Filtra para mostrar apenas OS atribuidas ao usuario</p>
                </div>
              </td>
              {ROLES.map(role => {
                const isAdminRole = role.key === 'admin'
                const checked = !isAdminRole && (configs[role.key]?.own_only ?? false)
                return (
                  <td key={role.key} className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isAdminRole}
                      onChange={() => toggleOwnOnly(role.key)}
                      title={isAdminRole ? 'Admin sempre ve tudo' : `Ver apenas suas OS para ${role.label}`}
                      className={cn(
                        'h-4 w-4 rounded text-amber-600 focus:ring-amber-500',
                        isAdminRole && 'opacity-50 cursor-not-allowed'
                      )}
                    />
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
        <p className="text-sm text-blue-700">
          <strong>Admin</strong> sempre visualiza todas as colunas e todas as OS, independente da configuracao.
          As alteracoes afetam apenas os demais perfis.
        </p>
      </div>
    </div>
  )
}
