'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Send, Eye, Loader2, Clock, CheckCircle2, Mail } from 'lucide-react'

interface QuoteReminderConfig {
  enabled: boolean
  days_waiting: number
  interval_days: number
  max_reminders: number
}

interface AwaitingItem {
  id: string
  os_number: number
  customer_name: string
  customer_email: string | null
  equipment: string
  total_cost: number
  days_waiting: number
  reminders_sent: number
  status_name: string
  status_changed_at: string
}

const AVAILABLE_VARS = [
  { var: '{{customer_name}}', desc: 'Nome do cliente' },
  { var: '{{os_number}}', desc: 'Número da OS' },
  { var: '{{equipment}}', desc: 'Equipamento (tipo + marca + modelo)' },
  { var: '{{diagnosis}}', desc: 'Diagnóstico do técnico' },
  { var: '{{total_cost}}', desc: 'Valor total do orçamento' },
  { var: '{{days_waiting}}', desc: 'Dias aguardando aprovação' },
  { var: '{{approval_link}}', desc: 'Link para aprovar orçamento' },
  { var: '{{rejection_link}}', desc: 'Link para recusar orçamento' },
  { var: '{{items_table}}', desc: 'Tabela HTML com serviços e peças' },
  { var: '{{company_name}}', desc: 'Nome da empresa' },
  { var: '{{company_phone}}', desc: 'Telefone da empresa' },
]

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function fmtDate(date: string): string {
  return new Date(date).toLocaleDateString('pt-BR')
}

export default function LembreteOrcamentoConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [config, setConfig] = useState<QuoteReminderConfig>({
    enabled: true,
    days_waiting: 5,
    interval_days: 3,
    max_reminders: 3,
  })
  const [template, setTemplate] = useState('')
  const [savedTemplate, setSavedTemplate] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [awaitingItems, setAwaitingItems] = useState<AwaitingItem[]>([])
  const [canSend, setCanSend] = useState(0)
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
          enabled: flat['quote_reminder.enabled'] !== 'false',
          days_waiting: parseInt(flat['quote_reminder.days_waiting'] || '5', 10),
          interval_days: parseInt(flat['quote_reminder.interval_days'] || '3', 10),
          max_reminders: parseInt(flat['quote_reminder.max_reminders'] || '3', 10),
        })
        // Load saved template
        if (flat['quote_reminder.email_template']) {
          setTemplate(flat['quote_reminder.email_template'])
          setSavedTemplate(flat['quote_reminder.email_template'])
        }
      }

      // Load awaiting items
      const awaitingRes = await fetch('/api/os/lembrete-orcamento')
      const awaitingData = await awaitingRes.json()
      if (awaitingData.data) {
        setAwaitingItems(awaitingData.data.orders || [])
        setCanSend(awaitingData.data.can_send || 0)
      }
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
        { key: 'quote_reminder.enabled', value: String(config.enabled), type: 'string', group: 'quote_reminder' },
        { key: 'quote_reminder.days_waiting', value: String(config.days_waiting), type: 'string', group: 'quote_reminder' },
        { key: 'quote_reminder.interval_days', value: String(config.interval_days), type: 'string', group: 'quote_reminder' },
        { key: 'quote_reminder.max_reminders', value: String(config.max_reminders), type: 'string', group: 'quote_reminder' },
      ]
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      toast.success('Configurações salvas!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveTemplate() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: [
            { key: 'quote_reminder.email_template', value: template, type: 'string', group: 'quote_reminder' },
          ],
        }),
      })
      if (!res.ok) throw new Error('Erro ao salvar template')
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
      // Simple client-side preview with sample data
      const sampleVars: Record<string, string> = {
        customer_name: 'João da Silva (exemplo)',
        os_number: '1234',
        equipment: 'Impressora HP LaserJet Pro M404',
        diagnosis: 'Fusor com desgaste, necessita substituição. Roletes de alimentação comprometidos.',
        total_cost: 'R$ 450,00',
        days_waiting: '7',
        approval_link: '#preview',
        rejection_link: '#preview',
        company_name: 'Empresa (exemplo)',
        company_phone: '(11) 99999-9999',
        items_table: `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <thead><tr style="background:#f8fafc;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Descrição</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Tipo</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Qtd</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Unit.</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Total</th>
          </tr></thead>
          <tbody>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">Troca do Fusor</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9;font-size:13px;">Serviço</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9;font-size:13px;">1</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:13px;">R$ 150,00</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">R$ 150,00</td></tr>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">Fusor HP M404</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9;font-size:13px;">Peça</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9;font-size:13px;">1</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:13px;">R$ 250,00</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">R$ 250,00</td></tr>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">Roletes de Alimentação</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9;font-size:13px;">Peça</td><td style="padding:8px 12px;text-align:center;border-bottom:1px solid #f1f5f9;font-size:13px;">1</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:13px;">R$ 50,00</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;">R$ 50,00</td></tr>
          </tbody>
        </table>`,
      }

      let html = template
      for (const [key, value] of Object.entries(sampleVars)) {
        html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
      }
      setPreviewHtml(html)
    } catch (err) {
      toast.error('Erro ao gerar preview')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSendAll() {
    if (!confirm(`Confirma o envio de lembretes para ${canSend} OS aguardando aprovação?`)) return
    setSending(true)
    try {
      const res = await fetch('/api/os/lembrete-orcamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.data) {
        toast.success(`${data.data.sent} lembrete(s) enviado(s) com sucesso!`)
        if (data.data.errors?.length) {
          data.data.errors.forEach((e: string) => toast.error(e))
        }
        loadData()
      } else {
        throw new Error(data.error || 'Erro ao enviar')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar lembretes')
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
          <h1 className="text-2xl font-bold text-gray-900">Lembrete de Orçamento</h1>
          <p className="text-sm text-gray-500">Lembrete automático para orçamentos pendentes de aprovação</p>
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
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Configurações de Lembrete</h2>

          <div className="space-y-6">
            {/* Enable/Disable */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Lembrete automático ativado</p>
                <p className="text-sm text-gray-500">Envia lembretes para clientes com orçamento pendente</p>
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

            {/* Days waiting */}
            <div>
              <label className="block font-medium text-gray-900">
                Dias antes do primeiro lembrete
              </label>
              <p className="mb-2 text-sm text-gray-500">
                Envia o primeiro lembrete após X dias aguardando aprovação
              </p>
              <input
                type="number"
                min={1}
                max={90}
                value={config.days_waiting}
                onChange={e => setConfig(prev => ({ ...prev, days_waiting: parseInt(e.target.value) || 5 }))}
                className="w-32 rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Interval */}
            <div>
              <label className="block font-medium text-gray-900">
                Intervalo entre lembretes (dias)
              </label>
              <p className="mb-2 text-sm text-gray-500">
                Mínimo de dias entre cada lembrete para a mesma OS
              </p>
              <input
                type="number"
                min={1}
                max={90}
                value={config.interval_days}
                onChange={e => setConfig(prev => ({ ...prev, interval_days: parseInt(e.target.value) || 3 }))}
                className="w-32 rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Max reminders */}
            <div>
              <label className="block font-medium text-gray-900">
                Máximo de lembretes por OS
              </label>
              <p className="mb-2 text-sm text-gray-500">
                Para de enviar após atingir este número
              </p>
              <input
                type="number"
                min={1}
                max={20}
                value={config.max_reminders}
                onChange={e => setConfig(prev => ({ ...prev, max_reminders: parseInt(e.target.value) || 3 }))}
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
              placeholder="Cole o HTML do template aqui. Deixe vazio para usar o template padrão."
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
                disabled={previewing || !template}
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
                    ? `${canSend} lembrete(s) pendente(s) de envio`
                    : 'Nenhum lembrete pendente para envio'
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
                Enviar lembretes agora
              </button>
            </div>
          </div>

          {/* Awaiting list */}
          <div className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-4">
              <h3 className="font-semibold text-gray-900">OS Aguardando Aprovação ({awaitingItems.length})</h3>
            </div>
            {awaitingItems.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-400" />
                <p>Nenhuma OS aguardando aprovação de orçamento</p>
              </div>
            ) : (
              <div className="divide-y">
                {awaitingItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900">
                        OS-{item.os_number} - {item.customer_name}
                      </p>
                      <p className="text-sm text-gray-500">{item.equipment}</p>
                      <div className="mt-1 flex gap-3 text-xs text-gray-400">
                        <span className="font-medium text-yellow-600">{item.days_waiting} dias aguardando</span>
                        <span>Lembretes: {item.reminders_sent}</span>
                        {item.status_changed_at && (
                          <span>Desde: {fmtDate(item.status_changed_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{fmtCents(item.total_cost)}</p>
                      {item.customer_email ? (
                        <p className="text-xs text-gray-400">{item.customer_email}</p>
                      ) : (
                        <p className="text-xs text-red-400">Sem email</p>
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
            <p className="text-sm text-gray-500">Últimos lembretes de orçamento enviados</p>
          </div>
          <div className="p-8 text-center text-gray-400">
            <Mail className="mx-auto mb-2 h-8 w-8" />
            <p>O histórico será exibido após o primeiro envio de lembretes.</p>
            <p className="mt-1 text-xs">Os registros são salvos no log de auditoria do sistema.</p>
          </div>
        </div>
      )}
    </div>
  )
}
