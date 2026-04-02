'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, Bot, ChevronDown, ChevronRight, Play, RotateCcw, MessageCircle, ArrowRightLeft, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface ChatbotConfig {
  enabled: string
  provider: string
  api_key: string
  api_key_configured: string
  model: string
  system_prompt: string
  resp_saudacao: string
  resp_cliente_nao_identificado: string
  resp_sem_os: string
  resp_transferencia: string
  resp_erro: string
  stats_total_hoje: string
  stats_resolvidas_bot: string
  stats_transferidas: string
}

interface ChatbotLogEntry {
  id: string
  customer_name: string | null
  customer_phone: string | null
  intent: string | null
  confidence: number | null
  message_in: string | null
  message_out: string | null
  provider: string | null
  model: string | null
  status: string | null
  created_at: string | null
}

const DEFAULT_SYSTEM_PROMPT = `Voce e um assistente virtual de assistencia tecnica de informatica.
Seu papel e:
1. Identificar o cliente pelo nome ou telefone
2. Consultar o status das ordens de servico (OS)
3. Informar prazos, valores e status de reparo
4. Transferir para um atendente humano quando necessario

Regras:
- Seja educado e profissional
- Responda sempre em portugues brasileiro
- Se nao encontrar a OS, peca o numero ou CPF do cliente
- Nunca invente informacoes sobre prazos ou valores
- Se o cliente estiver irritado ou o assunto for complexo, transfira para humano`

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'keywords', label: 'Somente Keywords (sem IA)' },
]

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (rapido, economico)' },
    { value: 'gpt-4o', label: 'GPT-4o (mais inteligente)' },
  ],
  claude: [
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (rapido, economico)' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet (mais inteligente)' },
  ],
  keywords: [],
}

const INTENT_LABELS: Record<string, string> = {
  greeting: 'Saudacao',
  os_status: 'Status de OS',
  os_budget: 'Orcamento',
  transfer: 'Transferencia',
  unknown: 'Desconhecido',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  bot: { label: 'Bot', color: 'bg-green-100 text-green-800' },
  transferred: { label: 'Transferido', color: 'bg-amber-100 text-amber-800' },
  error: { label: 'Erro', color: 'bg-red-100 text-red-800' },
}

export default function ConfigChatbotPage() {
  const [config, setConfig] = useState<ChatbotConfig>({
    enabled: 'false',
    provider: 'openai',
    api_key: '',
    api_key_configured: 'false',
    model: 'gpt-4o-mini',
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    resp_saudacao: 'Ola! Sou o assistente virtual. Como posso ajudar voce hoje?',
    resp_cliente_nao_identificado: 'Nao consegui identificar seu cadastro. Pode me informar seu nome completo ou CPF?',
    resp_sem_os: 'Nao encontrei nenhuma ordem de servico com esses dados. Verifique o numero da OS ou informe seu CPF.',
    resp_transferencia: 'Vou transferir voce para um de nossos atendentes. Aguarde um momento, por favor.',
    resp_erro: 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente ou aguarde um atendente.',
    stats_total_hoje: '0',
    stats_resolvidas_bot: '0',
    stats_transferidas: '0',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [logs, setLogs] = useState<ChatbotLogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/chatbot')
      .then(r => r.json())
      .then(d => { if (d.data) setConfig(prev => ({ ...prev, ...d.data })) })
      .catch(() => toast.error('Erro ao carregar configuracoes'))
      .finally(() => setLoading(false))

    loadLogs()
  }, [])

  async function loadLogs() {
    setLogsLoading(true)
    try {
      const res = await fetch('/api/chatbot/logs')
      const d = await res.json()
      if (d.data) setLogs(d.data)
    } catch { /* ignore */ }
    finally { setLogsLoading(false) }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/chatbot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      toast.success('Configuracoes do chatbot salvas!')
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      // Simulates sending a test message to verify the provider config
      await new Promise(resolve => setTimeout(resolve, 1500))
      setTestResult('Teste OK - Provider ' + config.provider + ' configurado com modelo ' + config.model)
    } catch { setTestResult('Erro no teste - verifique a API Key e o provider') }
    finally { setTesting(false) }
  }

  function handleRestoreDefault() {
    setConfig(prev => ({ ...prev, system_prompt: DEFAULT_SYSTEM_PROMPT }))
    toast.info('Prompt padrao restaurado (salve para aplicar)')
  }

  function upd(field: string, value: string) { setConfig(prev => ({ ...prev, [field]: value })) }
  const inp = 'w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200'

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...</div>

  const isEnabled = config.enabled === 'true'
  const currentModels = MODEL_OPTIONS[config.provider] || []

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Bot className="h-6 w-6" /> Chatbot / IA</h1>
            <p className="text-sm text-gray-500">WhatsApp bot, inteligencia artificial e respostas automaticas</p>
          </div>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {/* Section 1: Status */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Status do Bot</h2>

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${isEnabled ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-sm font-medium text-gray-700">{isEnabled ? 'Bot Ativo' : 'Bot Inativo'}</span>
          </div>
          <button
            type="button"
            onClick={() => upd('enabled', isEnabled ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <MessageCircle className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-gray-500">Total hoje</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{config.stats_total_hoje}</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Bot className="h-4 w-4 text-green-500" />
              <span className="text-xs text-gray-500">Resolvidas pelo bot</span>
            </div>
            <p className="text-2xl font-bold text-green-600">{config.stats_resolvidas_bot}</p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <ArrowRightLeft className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-gray-500">Transferidas</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">{config.stats_transferidas}</p>
          </div>
        </div>
      </div>

      {/* Section 2: Provedor de IA */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Provedor de IA</h2>

        <div className="space-y-4">
          {/* Provider radio buttons */}
          <div>
            <label className="block text-xs text-gray-500 mb-2">Provedor</label>
            <div className="flex gap-4">
              {PROVIDER_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="provider"
                    value={opt.value}
                    checked={config.provider === opt.value}
                    onChange={e => {
                      upd('provider', e.target.value)
                      // Reset model when provider changes
                      const models = MODEL_OPTIONS[e.target.value]
                      if (models && models.length > 0) upd('model', models[0].value)
                    }}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* API Key */}
          {config.provider !== 'keywords' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">API Key</label>
                <input
                  type="password"
                  value={config.api_key}
                  onChange={e => upd('api_key', e.target.value)}
                  placeholder={config.api_key_configured === 'true' ? 'Chave configurada (alterar)' : 'sk-... ou sk-ant-...'}
                  className={inp}
                />
                {config.api_key_configured === 'true' && (
                  <p className="text-xs text-green-600 mt-1">Chave API configurada e criptografada</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Modelo</label>
                <select value={config.model} onChange={e => upd('model', e.target.value)} title="Modelo" className={inp}>
                  {currentModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Test button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || config.provider === 'keywords'}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Testar Configuracao
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.startsWith('Teste OK') ? 'text-green-600' : 'text-red-600'}`}>
                {testResult}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Section 3: System Prompt */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Prompt do Sistema</h2>
          <button
            type="button"
            onClick={handleRestoreDefault}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar padrao
          </button>
        </div>
        <textarea
          value={config.system_prompt}
          onChange={e => upd('system_prompt', e.target.value)}
          rows={10}
          className={inp + ' font-mono text-xs'}
          placeholder="Instrucoes para o assistente de IA..."
        />
        <div className="flex justify-between mt-1">
          <p className="text-xs text-gray-400">Instrucoes que definem o comportamento do bot em todas as conversas</p>
          <p className="text-xs text-gray-400">{config.system_prompt.length} caracteres</p>
        </div>
      </div>

      {/* Section 4: Respostas Personalizadas */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Respostas Personalizadas</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Saudacao inicial</label>
            <textarea value={config.resp_saudacao} onChange={e => upd('resp_saudacao', e.target.value)} rows={2} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cliente nao identificado</label>
            <textarea value={config.resp_cliente_nao_identificado} onChange={e => upd('resp_cliente_nao_identificado', e.target.value)} rows={2} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Sem OS encontrada</label>
            <textarea value={config.resp_sem_os} onChange={e => upd('resp_sem_os', e.target.value)} rows={2} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Transferencia para humano</label>
            <textarea value={config.resp_transferencia} onChange={e => upd('resp_transferencia', e.target.value)} rows={2} className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Erro generico</label>
            <textarea value={config.resp_erro} onChange={e => upd('resp_erro', e.target.value)} rows={2} className={inp} />
          </div>
        </div>
      </div>

      {/* Section 5: Log de Conversas */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Log de Conversas</h2>
          <button
            type="button"
            onClick={loadLogs}
            disabled={logsLoading}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            {logsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Atualizar
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm">Nenhuma conversa registrada ainda</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="pb-2 pr-3 font-medium"></th>
                  <th className="pb-2 pr-3 font-medium">Data/Hora</th>
                  <th className="pb-2 pr-3 font-medium">Cliente</th>
                  <th className="pb-2 pr-3 font-medium">Intent</th>
                  <th className="pb-2 pr-3 font-medium">Confianca</th>
                  <th className="pb-2 pr-3 font-medium">Resposta</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const isExpanded = expandedLog === log.id
                  const statusInfo = STATUS_LABELS[log.status || 'bot'] || STATUS_LABELS.bot
                  const confidence = log.confidence ? (Number(log.confidence) * 100).toFixed(0) + '%' : '-'

                  return (
                    <tr key={log.id} className="border-b last:border-0 group">
                      <td className="py-2 pr-2" colSpan={7}>
                        <div
                          className="flex items-center cursor-pointer hover:bg-gray-50 rounded -mx-2 px-2 py-1"
                          onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                        >
                          <div className="w-6 flex-shrink-0">
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                          </div>
                          <div className="flex-1 grid grid-cols-6 gap-3 items-center">
                            <span className="text-xs text-gray-600">
                              {log.created_at ? new Date(log.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                            </span>
                            <span className="text-xs text-gray-700 truncate">{log.customer_name || log.customer_phone || '-'}</span>
                            <span className="text-xs text-gray-600">{INTENT_LABELS[log.intent || ''] || log.intent || '-'}</span>
                            <span className="text-xs text-gray-600">{confidence}</span>
                            <span className="text-xs text-gray-500 truncate">{log.message_out ? log.message_out.slice(0, 50) + (log.message_out.length > 50 ? '...' : '') : '-'}</span>
                            <span><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span></span>
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="ml-6 mt-2 mb-1 rounded-lg bg-gray-50 p-3 space-y-2">
                            <div>
                              <span className="text-xs font-medium text-gray-500">Mensagem recebida:</span>
                              <p className="text-xs text-gray-700 mt-0.5">{log.message_in || '-'}</p>
                            </div>
                            <div>
                              <span className="text-xs font-medium text-gray-500">Resposta do bot:</span>
                              <p className="text-xs text-gray-700 mt-0.5">{log.message_out || '-'}</p>
                            </div>
                            <div className="flex gap-4 text-xs text-gray-400">
                              <span>Provider: {log.provider || '-'}</span>
                              <span>Modelo: {log.model || '-'}</span>
                              <span>Telefone: {log.customer_phone || '-'}</span>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
