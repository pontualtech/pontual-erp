'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

interface ModuleStatus {
  id: string
  name: string
  color: string
  sort_order: number
  is_final: boolean
  module: string
}

export default function StatusPage() {
  const [statuses, setStatuses] = useState<ModuleStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/os/kanban')
      .then(r => r.json())
      .then(d => {
        // Extract statuses from kanban columns
        const cols = d.data?.columns ?? d.columns ?? []
        const mapped = cols.map((c: any) => ({
          id: c.id,
          name: c.name ?? c.status,
          color: c.color ?? '#6b7280',
          sort_order: c.sort_order ?? c.order ?? 0,
          is_final: c.is_final ?? false,
          module: 'os',
        }))
        setStatuses(mapped)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Status de OS</h1>
        <button className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Novo Status
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Cor</th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Ordem</th>
              <th className="px-4 py-3">Status Final</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
            ) : statuses.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Nenhum status encontrado</td></tr>
            ) : (
              statuses.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span
                      className="inline-block h-4 w-4 rounded-full border"
                      style={{ backgroundColor: s.color }}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500">{s.sort_order}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.is_final ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.is_final ? 'Sim' : 'Nao'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
