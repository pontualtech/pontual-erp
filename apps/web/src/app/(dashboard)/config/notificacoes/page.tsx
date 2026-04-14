'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Bell, Mail, MessageSquare, Loader2, Save, ChevronDown, ChevronUp, Zap, Hand, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NotifRule {
  mode: 'auto' | 'manual' | 'off'
  email: boolean
  whatsapp: boolean
  email_subject: string
  email_message: string
  whatsapp_message: string
}

interface StatusInfo {
  id: string
  name: string
  color: string | null
  order: number | null
  is_final: boolean
}

const MODE_CONFIG = {
  auto: { label: 'Automatico', desc: 'Envia ao mudar status', icon: Zap, color: 'bg-green-500', ring: 'ring-green-200' },
  manual: { label: 'Manual', desc: 'Botao na OS', icon: Hand, color: 'bg-amber-500', ring: 'ring-amber-200' },
  off: { label: 'Desligado', desc: 'Nao envia', icon: XCircle, color: 'bg-gray-400', ring: 'ring-gray-200' },
}

// Default for new/unconfigured statuses: manual (safe — admin must explicitly enable auto)
const DEFAULT_RULE: NotifRule = {
  mode: 'manual',
  email: true,
  whatsapp: true,
  email_subject: '',
  email_message: '',
  whatsapp_message: '',
}

export default function NotificacoesPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statuses, setStatuses] = useState<StatusInfo[]>([])
  const [rules, setRules] = useState<Record<string, NotifRule>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [permissionRequired, setPermissionRequired] = useState('os:edit')

  useEffect(() => {
    fetch('/api/settings/notificacoes')
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setStatuses(d.data.statuses || [])
          setRules(d.data.rules || {})
          setPermissionRequired(d.data.permission_required || 'os:edit')
        }
      })
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [])

  function getRule(statusId: string): NotifRule {
    return rules[statusId] || { ...DEFAULT_RULE }
  }

  function updateRule(statusId: string, updates: Partial<NotifRule>) {
    setRules(prev => ({
      ...prev,
      [statusId]: { ...getRule(statusId), ...updates },
    }))
  }

  function cycleMode(statusId: string) {
    const current = getRule(statusId).mode
    const next = current === 'auto' ? 'manual' : current === 'manual' ? 'off' : 'auto'
    updateRule(statusId, { mode: next })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/notificacoes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules, permission_required: permissionRequired }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      toast.success('Regras de notificacao salvas!')
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const inp = 'w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200'

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...</div>

  const activeCount = statuses.filter(s => getRule(s.id).mode !== 'off').length
  const autoCount = statuses.filter(s => getRule(s.id).mode === 'auto').length

  return (
    <div className="space-y-5 max-w-4xl pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Bell className="h-6 w-6" /> Notificacoes por Status</h1>
            <p className="text-sm text-gray-500">{autoCount} automaticas, {activeCount - autoCount} manuais, {statuses.length - activeCount} desligadas</p>
          </div>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        {Object.entries(MODE_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon
          return (
            <div key={key} className="flex items-center gap-1.5">
              <div className={cn('h-2.5 w-2.5 rounded-full', cfg.color)} />
              <Icon className="h-3.5 w-3.5" />
              <span className="font-medium">{cfg.label}</span>
              <span className="text-gray-400">— {cfg.desc}</span>
            </div>
          )
        })}
      </div>

      {/* Status rules */}
      <div className="space-y-2">
        {statuses.map(status => {
          const rule = getRule(status.id)
          const modeCfg = MODE_CONFIG[rule.mode]
          const ModeIcon = modeCfg.icon
          const isExpanded = expandedId === status.id
          const statusColor = status.color || '#6b7280'

          return (
            <div key={status.id} className={cn('rounded-xl border bg-white transition-all', rule.mode === 'off' ? 'opacity-50' : '')}>
              {/* Row */}
              <div className="flex items-center gap-3 p-4">
                {/* Status badge */}
                <div className="flex-shrink-0 w-36">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: statusColor }}>
                    {status.name}
                  </span>
                  {status.is_final && <span className="ml-1 text-[10px] text-gray-400">(final)</span>}
                </div>

                {/* Mode toggle */}
                <button type="button" onClick={() => cycleMode(status.id)}
                  className={cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all', `ring-2 ${modeCfg.ring}`)}>
                  <div className={cn('h-2.5 w-2.5 rounded-full', modeCfg.color)} />
                  <ModeIcon className="h-3.5 w-3.5" />
                  {modeCfg.label}
                </button>

                {/* Channels (only if not off) */}
                {rule.mode !== 'off' && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => updateRule(status.id, { email: !rule.email })}
                      title="Email" className={cn('flex items-center gap-1 rounded-lg px-2 py-1 text-xs border transition-colors',
                        rule.email ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-400')}>
                      <Mail className="h-3.5 w-3.5" /> Email
                    </button>
                    <button type="button" onClick={() => updateRule(status.id, { whatsapp: !rule.whatsapp })}
                      title="WhatsApp" className={cn('flex items-center gap-1 rounded-lg px-2 py-1 text-xs border transition-colors',
                        rule.whatsapp ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-400')}>
                      <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                    </button>
                  </div>
                )}

                {/* Expand button */}
                {rule.mode !== 'off' && (
                  <button type="button" onClick={() => setExpandedId(isExpanded ? null : status.id)}
                    className="ml-auto text-gray-400 hover:text-gray-600 p-1">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                )}
              </div>

              {/* Expanded: custom templates */}
              {isExpanded && rule.mode !== 'off' && (
                <div className="border-t px-4 py-4 bg-gray-50/50 space-y-4">
                  <p className="text-xs text-gray-500">Personalize as mensagens para este status. Deixe vazio para usar o padrao do sistema.</p>

                  {rule.email && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-blue-700 flex items-center gap-1"><Mail className="h-3 w-3" /> Email</label>
                      <input
                        type="text"
                        placeholder="Assunto do email (vazio = padrao)"
                        value={rule.email_subject}
                        onChange={e => updateRule(status.id, { email_subject: e.target.value })}
                        className={inp}
                      />
                      <textarea
                        placeholder="Mensagem personalizada do email (vazio = padrao do sistema)"
                        value={rule.email_message}
                        onChange={e => updateRule(status.id, { email_message: e.target.value })}
                        rows={3}
                        className={inp}
                      />
                      <p className="text-[10px] text-gray-400">Variaveis: {'{{cliente_nome}}'} {'{{os_numero}}'} {'{{equipamento}}'} {'{{status}}'} {'{{empresa}}'} {'{{portal_url}}'}</p>
                    </div>
                  )}

                  {rule.whatsapp && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-green-700 flex items-center gap-1"><MessageSquare className="h-3 w-3" /> WhatsApp</label>
                      <textarea
                        placeholder="Mensagem personalizada do WhatsApp (vazio = padrao do sistema)"
                        value={rule.whatsapp_message}
                        onChange={e => updateRule(status.id, { whatsapp_message: e.target.value })}
                        rows={3}
                        className={inp}
                      />
                      <p className="text-[10px] text-gray-400">Use *texto* para negrito. Variaveis: {'{{cliente_nome}}'} {'{{os_numero}}'} {'{{equipamento}}'} {'{{status}}'}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Permissao */}
      <div className="rounded-xl border bg-white p-5">
        <h2 className="font-semibold text-gray-900 mb-2">Controle de Acesso</h2>
        <p className="text-sm text-gray-500 mb-3">Qual permissao e necessaria para disparar notificacoes manuais?</p>
        <select
          value={permissionRequired}
          onChange={e => setPermissionRequired(e.target.value)}
          title="Permissao necessaria"
          className={inp + ' max-w-xs'}
        >
          <option value="os:edit">os:edit — Quem pode editar OS</option>
          <option value="os:create">os:create — Quem pode criar OS</option>
          <option value="config:edit">config:edit — Apenas administradores</option>
        </select>
      </div>
    </div>
  )
}
