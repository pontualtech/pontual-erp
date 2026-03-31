'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, FileText, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

const DEFAULT_TEMPLATE = 'Reparo em {{equipamento}} marca {{marca}} modelo {{modelo}}, numero de serie {{serie}}, conforme ordem de servico numero {{os_number}}. Garantia {{garantia}} dias.'

const VARIABLES = [
  { var: '{{equipamento}}', desc: 'Tipo do equipamento (ex: Impressora HP LaserJet)' },
  { var: '{{marca}}', desc: 'Marca do equipamento (ex: HP, Epson, Brother)' },
  { var: '{{modelo}}', desc: 'Modelo do equipamento (ex: L355, M404)' },
  { var: '{{serie}}', desc: 'Numero de serie do equipamento' },
  { var: '{{os_number}}', desc: 'Numero da Ordem de Servico' },
  { var: '{{garantia}}', desc: 'Dias de garantia (configuravel abaixo)' },
  { var: '{{cliente}}', desc: 'Nome/Razao social do cliente' },
  { var: '{{itens}}', desc: 'Lista detalhada dos itens/servicos da OS' },
  { var: '{{valor}}', desc: 'Valor total da OS (ex: R$ 150,00)' },
]

export default function NfseTemplatePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)
  const [garantiaDias, setGarantiaDias] = useState('90')
  const [preview, setPreview] = useState('')

  useEffect(() => {
    fetch('/api/settings/nfse-template')
      .then(r => r.json())
      .then(d => {
        if (d.template) setTemplate(d.template)
        if (d.garantia_dias) setGarantiaDias(d.garantia_dias)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // Gerar preview com dados fictícios
    const p = template
      .replace(/\{\{equipamento\}\}/g, 'Impressora Epson L355')
      .replace(/\{\{marca\}\}/g, 'Epson')
      .replace(/\{\{modelo\}\}/g, 'L355')
      .replace(/\{\{serie\}\}/g, 'WMTM267062')
      .replace(/\{\{os_number\}\}/g, '53918')
      .replace(/\{\{garantia\}\}/g, garantiaDias)
      .replace(/\{\{cliente\}\}/g, 'EMPRESA EXEMPLO LTDA')
      .replace(/\{\{itens\}\}/g, '- Mao de Obra (1x R$ 150.00)\n- Troca Cabeça (1x R$ 89.90)')
      .replace(/\{\{valor\}\}/g, 'R$ 239,90')
    setPreview(p)
  }, [template, garantiaDias])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/nfse-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, garantia_dias: garantiaDias }),
      })
      if (res.ok) toast.success('Template salvo com sucesso!')
      else toast.error('Erro ao salvar')
    } catch {
      toast.error('Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Template NFS-e</h1>
          <p className="text-sm text-gray-500">Discriminacao do servico que aparece na Nota Fiscal</p>
        </div>
      </div>

      {/* Template editor */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-purple-600" />
            Texto da Discriminacao
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Use as variaveis abaixo para inserir dados automaticos da OS
          </p>
        </div>
        <div className="p-6 space-y-4">
          <textarea
            value={template}
            onChange={e => setTemplate(e.target.value)}
            rows={5}
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTemplate(DEFAULT_TEMPLATE)}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrao
            </button>
          </div>

          {/* Variables reference */}
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Variaveis disponiveis</p>
            <div className="grid gap-1.5">
              {VARIABLES.map(v => (
                <div key={v.var} className="flex items-start gap-2 text-xs">
                  <code className="rounded bg-purple-100 px-1.5 py-0.5 font-mono text-purple-700 whitespace-nowrap">{v.var}</code>
                  <span className="text-gray-500">{v.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Garantia */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900">Garantia Padrao</h2>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={garantiaDias}
              onChange={e => setGarantiaDias(e.target.value)}
              min={0}
              className="w-24 rounded-lg border px-3 py-2 text-sm text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            />
            <span className="text-sm text-gray-600">dias de garantia</span>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Substitui a variavel {'{{garantia}}'} no template acima
          </p>
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900">Pre-visualizacao</h2>
          <p className="text-sm text-gray-500 mt-1">Como ficara na NFS-e (com dados de exemplo)</p>
        </div>
        <div className="p-6">
          <div className="rounded-lg bg-gray-50 border p-4 text-sm text-gray-800 whitespace-pre-wrap">
            {preview}
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar Template'}
        </button>
      </div>
    </div>
  )
}
