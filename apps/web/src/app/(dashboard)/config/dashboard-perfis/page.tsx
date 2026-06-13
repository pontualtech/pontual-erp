'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Eye, EyeOff, LayoutDashboard, Loader2, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WidgetDef { id: string; label: string; management: boolean }
interface RoleRow {
  roleId: string
  roleName: string
  locked: boolean
  widgets: Record<string, boolean>
}

export default function DashboardPerfisPage() {
  const [catalog, setCatalog] = useState<WidgetDef[]>([])
  const [matrix, setMatrix] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/dashboard/role-widgets')
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setCatalog(d.data.catalog ?? [])
          setMatrix(d.data.matrix ?? [])
        }
      })
      .catch(() => toast.error('Erro ao carregar configuração'))
      .finally(() => setLoading(false))
  }, [])

  const toggle = (roleId: string, widgetId: string) => {
    setMatrix(prev => prev.map(r =>
      r.roleId === roleId && !r.locked
        ? { ...r, widgets: { ...r.widgets, [widgetId]: !r.widgets[widgetId] } }
        : r,
    ))
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload: Record<string, Record<string, boolean>> = {}
      for (const r of matrix) {
        if (!r.locked) payload[r.roleId] = r.widgets
      }
      const res = await fetch('/api/dashboard/role-widgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matrix: payload }),
      })
      if (!res.ok) throw new Error()
      toast.success('Configuração salva! Cada perfil verá os blocos liberados.')
    } catch {
      toast.error('Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/config" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Configurações
      </Link>

      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-lg bg-blue-50 p-2 text-blue-600"><LayoutDashboard className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard por Perfil</h1>
          <p className="text-sm text-gray-500">Libere ou bloqueie cada bloco do dashboard por perfil. O usuário só personaliza dentro do que você liberar. Admin vê tudo.</p>
        </div>
      </div>

      <div className="space-y-4">
        {matrix.map(role => (
          <div key={role.roleId} className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">{role.roleName}</h2>
              {role.locked && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5" /> Vê todos os blocos
                </span>
              )}
            </div>
            {!role.locked && (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {catalog.map(w => {
                  const on = role.widgets[w.id]
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => toggle(role.roleId, w.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors cursor-pointer',
                        on ? 'border-blue-200 bg-blue-50/50 text-gray-800' : 'border-gray-100 bg-gray-50 text-gray-400',
                      )}
                    >
                      {on ? <Eye className="h-4 w-4 shrink-0 text-blue-600" /> : <EyeOff className="h-4 w-4 shrink-0" />}
                      <span className="flex-1">{w.label}</span>
                      {w.management && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">gerencial</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 mt-6 flex justify-end border-t bg-white/80 py-4 backdrop-blur">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
        </button>
      </div>
    </div>
  )
}
