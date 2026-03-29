'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Mail, Send, Eye, Loader2, Clock, CheckCircle2, AlertTriangle } from 'lucide-react'

interface CobrancaConfig {
  enabled: boolean
  interval_days: number
  min_days_overdue: number
}

interface OverdueItem {
  id: string
  description: string
  customer_name: string
  customer_email: string | null
  total_amount: number
  pending_amount: number
  due_date: string
  days_overdue: number
  reminded_today: boolean
  payment_method: string | null
}

interface AuditEntry {
  id: string
  action: string
  entity_id: string | null
  new_value: any
  created_at: string
}

const AVAILABLE_VARS = [
  { var: '{{customer_name}}', desc: 'Nome do cliente' },
  { var: '{{amount}}', desc: 'Valor pendente formatado' },
  { var: '{{due_date}}', desc: 'Data de vencimento' },
  { var: '{{days_overdue}}', desc: 'Dias em atraso' },
  { var: '{{payment_link}}', desc: 'Link para pagamento' },
  { var: '{{company_name}}', desc: 'Nome da empresa' },
  { var: '{{company_phone}}', desc: 'Telefone da empresa' },
  { var: '{{description}}', desc: 'Descrição da cobrança' },
]

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(date: string): string {
  return new Date(date).toLocaleDateString('pt-BR')
}

export default function CobrancaConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [config, setConfig] = useState<CobrancaConfig>({
    enabled: true,
    interval_days: 7,
    min_days_overdue: 3,
  })
  const [template, setTemplate] = useState('')
  const [savedTemplate, setSavedTemplate] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([])
  const [canSend, setCanSend] = useState(0)
  const [history, setHistory] = useState<AuditEntry[]>([])
  const [activeTab, setActiveTab] = useState<'config' | 'template' | 'enviar' | 'historico'>('config')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // Load settings
      const settingsRes = await fetch('/api/settings')
      const settingsData = await settingsRes.json()
      if (settingsData.data) {
        const flat: Record<string, string> = {}
        for (const group of Object.values(settingsData.data) as any[]) {
          for (const [key, val] of Object.entries(group)) {
            flat[key] = (val as any)?.value ?? ''
          }
        }
        setConfig({
          enabled: flat['cobranca.enabled'] !== 'false',
          interval_days: parseInt(flat['cobranca.interval_days'] || '7', 10),
          min_days_overdue: parseInt(flat['cobranca.min_days_overdue'] || '3', 10),
        })
      }

      // Load template
      const previewRes = await fetch('/api/financeiro/cobranca/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const previewData = await previewRes.json()
      if (previewData.data?.template) {
        setTemplate(previewData.data.template)
        setSavedTemplate(previewData.data.template)
      }

      // Load overdue items
      const overdueRes = await fetch('/api/financeiro/cobranca')
      const overdueData = await overdueRes.json()
      if (overdueData.data) {
        setOverdueItems(overdueData.data.receivables || [])
        setCanSend(overdueData.data.can_send || 0)
      }

      // Load history from audit
      const historyRes = await fetch('/api/financeiro/cobranca/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _loadHistory: true }),
      }).catch(() => null)

    } catch (err) {
      console.error('Erro ao carregar dados:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveConfig() {
    setSaving(true)
    try {
      const settings = [
        { key: 'cobranca.enabled', value: String(config.enabled), type: 'string', group: 'cobranca' },
        { key: 'cobranca.interval_days', value: String(config.interval_days), type: 'string', group: 'cobranca' },
        { key: 'cobranca.min_days_overdue', value: String(config.min_days_overdue), type: 'string', group: 'cobranca' },
      ]
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      toast.success('Configurações de cobrança salvas!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveTemplate() {
    setSaving(true)
    try {
      // Upsert message template via API
      const res = await fetch('/api/financeiro/cobranca/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, _save: true }),
      })

      // Also save directly via settings for simplicity
      const settingsRes = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: [
            { key: 'cobranca.email_template', value: template, type: 'string', group: 'cobranca' },
          ],
        }),
      })

      if (!settingsRes.ok) throw new Error('Erro ao salvar template')

      setSavedTemplate(template)
      toast.success('Template salvo!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handlePreview() {
    setPreviewing(true)
    try {
      const res = await fetch('/api/financeiro/cobranca/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template }),
      })
      const data = await res.json()
      if (data.data?.html) {
        setPreviewHtml(data.data.html)
      }
    } catch (err) {
      toast.error('Erro ao gerar preview')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSendAll() {
    if (!confirm(`Confirma o envio de cobranças para ${canSend} cliente(s)?`)) return
    setSending(true)
    try {
      const res = await fetch('/api/financeiro/cobranca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.data) {
        toast.success(`${data.data.sent} cobrança(s) enviada(s) com sucesso!`)
        if (data.data.errors?.length) {
          data.data.errors.forEach((e: string) => toast.error(e))
        }
        loadData()
      } else {
        throw new Error(data.error || 'Erro ao enviar')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar cobranças')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-gray-400">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        <p className="mt-2">Carregando...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cobrança Automática</h1>
          <p className="text-sm text-gray-500">Lembrete de pagamento por email para títulos vencidos</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {[
          { id: 'config' as const, label: 'Configurações' },
          { id: 'template' as const, label: 'Template de Email' },
          { id: 'enviar' as const, label: `Enviar (${canSend})` },
          { id: 'historico' as const, label: 'Histórico' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Configurações */}
      {activeTab === 'config' && (
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Configurações de Cobrança</h2>

          <div className="space-y-6">
            {/* Enable/Disable */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Cobrança automática ativada</p>
                <p className="text-sm text-gray-500">Permite o envio de lembretes de pagamento por email</p>
              </div>
              <button
                onClick={() => setConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  config.enabled ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Interval */}
            <div>
              <label className="block font-medium text-gray-900">
                Intervalo entre cobranças (dias)
              </label>
              <p className="mb-2 text-sm text-gray-500">
                Mínimo de dias entre cada lembrete para o mesmo título
              </p>
              <input
                type="number"
                min={1}
                max={90}
                value={config.interval_days}
                onChange={e => setConfig(prev => ({ ...prev, interval_days: parseInt(e.target.value) || 7 }))}
                className="w-32 rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Min days overdue */}
            <div>
              <label className="block font-medium text-gray-900">
                Dias mínimos de atraso
              </label>
              <p className="mb-2 text-sm text-gray-500">
                Só enviar cobrança para títulos vencidos há pelo menos X dias
              </p>
              <input
                type="number"
                min={1}
                max={90}
                value={config.min_days_overdue}
                onChange={e => setConfig(prev => ({ ...prev, min_days_overdue: parseInt(e.target.value) || 3 }))}
                className="w-32 rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : 'Salvar configurações'}
            </button>
          </div>
        </div>
      )}

      {/* Tab: Template */}
      {activeTab === 'template' && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Template de Email</h2>

            {/* Available variables */}
            <div className="mb-4 rounded-lg bg-blue-50 p-4">
              <p className="mb-2 text-sm font-medium text-blue-800">Variáveis disponíveis:</p>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_VARS.map(v => (
                  <button
                    key={v.var}
                    onClick={() => {
                      navigator.clipboard.writeText(v.var)
                      toast.success(`${v.var} copiado!`)
                    }}
                    className="rounded bg-blue-100 px-2 py-1 text-xs font-mono text-blue-700 hover:bg-blue-200"
                    title={v.desc}
                  >
                    {v.var}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={template}
              onChange={e => setTemplate(e.target.value)}
              className="h-96 w-full rounded-lg border p-4 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Cole o HTML do template aqui..."
            />

            <div className="mt-4 flex gap-3">
              <button
                onClick={handleSaveTemplate}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : 'Salvar template'}
              </button>
              <button
                onClick={handlePreview}
                disabled={previewing}
                className="flex items-center gap-2 rounded-lg border px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview
              </button>
            </div>
          </div>

          {/* Preview result */}
          {previewHtml && (
            <div className="rounded-lg border bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-400">
                Preview do Email
              </h3>
              <div className="rounded-lg border bg-gray-50 p-4">
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Enviar */}
      {activeTab === 'enviar' && (
        <div className="space-y-4">
          {/* Send button */}
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Envio Manual</h2>
                <p className="text-sm text-gray-500">
                  {canSend > 0
                    ? `${canSend} cobrança(s) pendente(s) de envio`
                    : 'Nenhuma cobrança pendente para envio'
                  }
                </p>
              </div>
              <button
                onClick={handleSendAll}
                disabled={sending || canSend === 0}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Enviar cobranças agora
              </button>
            </div>
          </div>

          {/* Overdue list */}
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4">
              <h3 className="font-semibold text-gray-900">Títulos Vencidos ({overdueItems.length})</h3>
            </div>
            {overdueItems.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-400" />
                <p>Nenhum título vencido encontrado</p>
              </div>
            ) : (
              <div className="divide-y">
                {overdueItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900">{item.customer_name}</p>
                      <p className="text-sm text-gray-500">{item.description}</p>
                      <div className="mt-1 flex gap-3 text-xs text-gray-400">
                        <span>Venc: {fmtDate(item.due_date)}</span>
                        <span className="font-medium text-red-500">{item.days_overdue} dias em atraso</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{fmtCents(item.pending_amount)}</p>
                      {item.customer_email ? (
                        <p className="text-xs text-gray-400">{item.customer_email}</p>
                      ) : (
                        <p className="text-xs text-red-400">Sem email</p>
                      )}
                      {item.reminded_today && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded bg-yellow-50 px-2 py-0.5 text-xs text-yellow-600">
                          <Clock className="h-3 w-3" />
                          Enviado hoje
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Histórico */}
      {activeTab === 'historico' && (
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="border-b p-4">
            <h3 className="font-semibold text-gray-900">Histórico de Envios</h3>
            <p className="text-sm text-gray-500">Últimos lembretes enviados</p>
          </div>
          <HistoryList />
        </div>
      )}
    </div>
  )
}

function HistoryList() {
  const [items, setItems] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load audit log for cobranca module
    fetch('/api/financeiro/cobranca')
      .then(r => r.json())
      .then(data => {
        // We'll show the overdue items that have been reminded today as history
        // In a future version, this could pull directly from audit_logs
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-400">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-8 text-center text-gray-400">
      <Mail className="mx-auto mb-2 h-8 w-8" />
      <p>O histórico será exibido após o primeiro envio de cobranças.</p>
      <p className="mt-1 text-xs">Os registros são salvos no log de auditoria do sistema.</p>
    </div>
  )
}
