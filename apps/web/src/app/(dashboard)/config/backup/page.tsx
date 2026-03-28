'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Database, Download, Loader2, FileSpreadsheet, FileJson } from 'lucide-react'

export default function BackupPage() {
  const [exporting, setExporting] = useState<string | null>(null)

  async function handleExport(entity: string, format: 'json' | 'csv') {
    setExporting(entity)
    try {
      const res = await fetch(`/api/${entity}?limit=9999`)
      const d = await res.json()
      const items = d.data ?? []
      if (items.length === 0) { toast.error('Nenhum dado encontrado'); return }

      let content: string
      let mime: string
      let ext: string

      if (format === 'csv') {
        const keys = Object.keys(items[0])
        const header = keys.join(';')
        const rows = items.map((item: any) => keys.map(k => {
          const v = item[k]
          if (v === null || v === undefined) return ''
          if (typeof v === 'object') return JSON.stringify(v).replace(/"/g, "'")
          return String(v).replace(/;/g, ',')
        }).join(';'))
        content = [header, ...rows].join('\n')
        mime = 'text/csv;charset=utf-8'
        ext = 'csv'
      } else {
        content = JSON.stringify(items, null, 2)
        mime = 'application/json'
        ext = 'json'
      }

      const blob = new Blob(['\uFEFF' + content], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${entity.replace(/\//g, '-')}_${new Date().toISOString().split('T')[0]}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${entity} exportado!`)
    } catch (err) {
      toast.error('Erro ao exportar')
    } finally {
      setExporting(null)
    }
  }

  const entities = [
    { key: 'clientes', label: 'Clientes', icon: '👥' },
    { key: 'produtos', label: 'Produtos e Serviços', icon: '📦' },
    { key: 'os', label: 'Ordens de Serviço', icon: '📋' },
    { key: 'financeiro/contas-pagar', label: 'Contas a Pagar', icon: '💸' },
    { key: 'financeiro/contas-receber', label: 'Contas a Receber', icon: '💰' },
    { key: 'financeiro/categorias', label: 'Categorias Financeiras', icon: '📂' },
    { key: 'financeiro/centros-custo', label: 'Centros de Custo', icon: '🎯' },
    { key: 'financeiro/contas-bancarias', label: 'Contas Bancárias', icon: '🏦' },
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Backup e Exportação</h1>
          <p className="text-sm text-gray-500">Exporte seus dados em CSV ou JSON</p>
        </div>
      </div>

      <div className="rounded-lg border bg-white shadow-sm divide-y">
        {entities.map(e => (
          <div key={e.key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50">
            <div className="flex items-center gap-3">
              <span className="text-xl">{e.icon}</span>
              <span className="font-medium text-gray-900 text-sm">{e.label}</span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => handleExport(e.key, 'csv')}
                disabled={exporting === e.key}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-gray-100 text-gray-600 font-medium disabled:opacity-50">
                {exporting === e.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                CSV
              </button>
              <button type="button" onClick={() => handleExport(e.key, 'json')}
                disabled={exporting === e.key}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-gray-100 text-gray-600 font-medium disabled:opacity-50">
                {exporting === e.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />}
                JSON
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-amber-50 border-amber-200 p-4">
        <div className="flex items-start gap-3">
          <Database className="h-5 w-5 text-amber-600 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">Sobre o backup</p>
            <ul className="mt-1 space-y-1 text-amber-700">
              <li>• Os dados são exportados do banco de dados em tempo real</li>
              <li>• CSV usa ponto-e-vírgula (;) como separador — compatível com Excel</li>
              <li>• JSON contém todos os campos incluindo relacionamentos</li>
              <li>• O banco de dados PostgreSQL possui backup automático pelo Coolify</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
