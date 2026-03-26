'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

interface CustomField {
  id: string
  field_name: string
  field_label: string
  field_type: string
  required: boolean
  module: string
  sort_order: number
}

const fieldTypeLabel: Record<string, string> = {
  TEXT: 'Texto',
  NUMBER: 'Numero',
  DATE: 'Data',
  SELECT: 'Selecao',
  TEXTAREA: 'Texto longo',
  CHECKBOX: 'Checkbox',
  FILE: 'Arquivo',
}

export default function CamposPage() {
  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [module, setModule] = useState('os')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/custom-fields?module=${module}`)
      .then(r => r.json())
      .then(d => setFields(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [module])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Campos Personalizados</h1>
        <button className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Novo Campo
        </button>
      </div>

      <div className="flex items-center gap-3">
        <select
          aria-label="Filtrar por modulo"
          value={module}
          onChange={e => setModule(e.target.value)}
          className="rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          <option value="os">Ordem de Servico</option>
          <option value="customers">Clientes</option>
          <option value="products">Produtos</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Nome do Campo</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Obrigatorio</th>
              <th className="px-4 py-3">Ordem</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Carregando...</td></tr>
            ) : fields.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Nenhum campo personalizado encontrado</td></tr>
            ) : (
              fields.map(f => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 font-mono text-xs">{f.field_name}</td>
                  <td className="px-4 py-3 text-gray-700">{f.field_label}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">
                      {fieldTypeLabel[f.field_type] ?? f.field_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.required ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                      {f.required ? 'Sim' : 'Nao'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{f.sort_order}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
