'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Save, Eye, Loader2, FileText } from 'lucide-react'

interface QuoteEmailConfig {
  warranty: string
  execution_days: string
  validity: string
  max_installments: string
  payment_conditions: string
  observations: string
}

const DEFAULT_CONFIG: QuoteEmailConfig = {
  warranty: '3 MESES',
  execution_days: '10 dias uteis',
  validity: '2 dias',
  max_installments: '3',
  payment_conditions: 'PIX, Dinheiro, Cartao de credito (ate 3x sem juros), Cartao de debito',
  observations: '',
}

const SETTINGS_KEYS: Record<keyof QuoteEmailConfig, string> = {
  warranty: 'quote.warranty',
  execution_days: 'quote.execution_days',
  validity: 'quote.validity',
  max_installments: 'quote.max_installments',
  payment_conditions: 'quote.payment_conditions',
  observations: 'quote.observations',
}

export default function OrcamentoEmailConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [config, setConfig] = useState<QuoteEmailConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    try {
      const res = await fetch('/api/settings')
      const data = await res.json()
      if (data.data) {
        const flat: Record<string, string> = {}
        for (const group of Object.values(data.data) as any[]) {
          if (Array.isArray(group)) {
            for (const s of group) {
              if (s.key && s.value !== undefined) flat[s.key] = s.value
            }
          }
        }

        setConfig({
          warranty: flat['quote.warranty'] || DEFAULT_CONFIG.warranty,
          execution_days: flat['quote.execution_days'] || DEFAULT_CONFIG.execution_days,
          validity: flat['quote.validity'] || DEFAULT_CONFIG.validity,
          max_installments: flat['quote.max_installments'] || DEFAULT_CONFIG.max_installments,
          payment_conditions: flat['quote.payment_conditions'] || DEFAULT_CONFIG.payment_conditions,
          observations: flat['quote.observations'] || DEFAULT_CONFIG.observations,
        })
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const entries = Object.entries(SETTINGS_KEYS).map(([field, key]) => ({
        key,
        value: config[field as keyof QuoteEmailConfig],
      }))

      for (const entry of entries) {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        })
      }

      toast.success('Configuracoes salvas com sucesso!')
    } catch {
      toast.error('Erro ao salvar configuracoes')
    } finally {
      setSaving(false)
    }
  }

  async function handlePreview() {
    setPreviewing(true)
    try {
      // First save, then preview with a sample OS
      await handleSave()

      // Find any OS with items to preview
      const osRes = await fetch('/api/os?limit=1&has_items=true')
      const osData = await osRes.json()
      const sampleOs = (osData.data ?? [])[0]

      if (!sampleOs) {
        toast.error('Nenhuma OS com itens encontrada para pre-visualizacao')
        setPreviewing(false)
        return
      }

      const previewRes = await fetch(`/api/os/${sampleOs.id}/enviar-orcamento`)
      if (!previewRes.ok) {
        toast.error('Erro ao gerar pre-visualizacao')
        setPreviewing(false)
        return
      }

      const html = await previewRes.text()
      setPreviewHtml(html)
    } catch {
      toast.error('Erro ao gerar pre-visualizacao')
    } finally {
      setPreviewing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg border p-2 hover:bg-gray-100 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Email de Orcamento</h1>
          <p className="text-sm text-gray-500">Template e condicoes do orcamento enviado por email</p>
        </div>
      </div>

      {/* Settings Form */}
      <div className="rounded-xl border bg-white p-6 shadow-sm space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Condicoes do Orcamento</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Garantia</label>
            <input
              type="text"
              value={config.warranty}
              onChange={e => setConfig({ ...config, warranty: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="3 MESES"
            />
            <p className="mt-1 text-xs text-gray-400">Ex: 3 MESES, 90 DIAS, 1 ANO</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prazo de Execucao</label>
            <input
              type="text"
              value={config.execution_days}
              onChange={e => setConfig({ ...config, execution_days: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="10 dias uteis"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Validade do Orcamento</label>
            <input
              type="text"
              value={config.validity}
              onChange={e => setConfig({ ...config, validity: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="2 dias"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Maximo de Parcelas</label>
            <input
              type="number"
              min="1"
              max="12"
              value={config.max_installments}
              onChange={e => setConfig({ ...config, max_installments: e.target.value })}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400">Exibido na opcao de parcelamento no email</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Formas de Pagamento</label>
          <textarea
            value={config.payment_conditions}
            onChange={e => setConfig({ ...config, payment_conditions: e.target.value })}
            rows={3}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="PIX, Dinheiro, Cartao de credito..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Observacoes</label>
          <textarea
            value={config.observations}
            onChange={e => setConfig({ ...config, observations: e.target.value })}
            rows={3}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            placeholder="Observacoes adicionais exibidas no email..."
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>

          <button
            type="button"
            onClick={handlePreview}
            disabled={previewing}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            Pre-visualizar Template
          </button>
        </div>
      </div>

      {/* Preview */}
      {previewHtml && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3 bg-gray-50">
            <h3 className="text-sm font-semibold text-gray-700">Pre-visualizacao do Email</h3>
            <button
              type="button"
              onClick={() => setPreviewHtml('')}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Fechar
            </button>
          </div>
          <div className="p-4">
            <iframe
              srcDoc={previewHtml}
              className="w-full border rounded-lg"
              style={{ minHeight: '800px' }}
              title="Preview do email de orcamento"
            />
          </div>
        </div>
      )}
    </div>
  )
}
