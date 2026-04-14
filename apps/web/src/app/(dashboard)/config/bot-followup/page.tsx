'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, MessageCircle, Clock, Shield, Plus, Trash2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const INTERVAL_PRESETS = [
  { label: '30 min', value: '30' },
  { label: '1 hora', value: '60' },
  { label: '2 horas', value: '120' },
  { label: '6 horas', value: '360' },
  { label: '12 horas', value: '720' },
  { label: '24 horas', value: '1440' },
  { label: '48 horas', value: '2880' },
  { label: '72 horas', value: '4320' },
]

const DAY_OPTIONS = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sab' },
]

interface FollowUpConfig {
  'bot.followup.enabled': string
  'bot.followup.max_attempts': string
  'bot.followup.interval_1_minutes': string
  'bot.followup.interval_2_minutes': string
  'bot.followup.interval_3_minutes': string
  'bot.followup.msg_1': string
  'bot.followup.msg_2': string
  'bot.followup.msg_3': string
  'bot.followup.business_hours_only': string
  'bot.followup.business_hour_start': string
  'bot.followup.business_hour_end': string
  'bot.followup.business_days': string
  'bot.followup.opt_out_keywords': string
}

const DEFAULTS: FollowUpConfig = {
  'bot.followup.enabled': 'true',
  'bot.followup.max_attempts': '3',
  'bot.followup.interval_1_minutes': '60',
  'bot.followup.interval_2_minutes': '1440',
  'bot.followup.interval_3_minutes': '4320',
  'bot.followup.msg_1': 'Oi! 😊 Vi que voce nao respondeu. Posso te ajudar com algo? Estou aqui para o que precisar!',
  'bot.followup.msg_2': 'Ola! Passando para saber se ainda precisa de ajuda. Se tiver qualquer duvida sobre nossos servicos, e so me chamar! 🔧',
  'bot.followup.msg_3': 'Oi! Essa e minha ultima mensagem para nao te incomodar. Se precisar de assistencia tecnica no futuro, estamos a disposicao! Ate mais! 👋',
  'bot.followup.business_hours_only': 'true',
  'bot.followup.business_hour_start': '8',
  'bot.followup.business_hour_end': '18',
  'bot.followup.business_days': '1,2,3,4,5',
  'bot.followup.opt_out_keywords': 'parar,cancelar,nao quero,sair,stop,pare,nao me mande,nao envie',
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`
  if (m < 1440) return `${Math.round(m / 60)}h`
  return `${Math.round(m / 1440)} dia(s)`
}

export default function BotFollowUpConfigPage() {
  const [config, setConfig] = useState<FollowUpConfig>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/bot-followup')
      .then(r => r.json())
      .then(d => { if (d.data) setConfig(prev => ({ ...prev, ...d.data })) })
      .catch(() => toast.error('Erro ao carregar configuracoes'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/bot-followup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      toast.success('Configuracoes de follow-up salvas!')
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  function upd(key: keyof FollowUpConfig, value: string) {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  function toggleDay(day: number) {
    const current = config['bot.followup.business_days'].split(',').map(Number).filter(n => !isNaN(n))
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day].sort()
    upd('bot.followup.business_days', updated.join(','))
  }

  function handleRestore() {
    setConfig(DEFAULTS)
    toast.info('Valores padrao restaurados (salve para aplicar)')
  }

  const isEnabled = config['bot.followup.enabled'] === 'true'
  const activeDays = config['bot.followup.business_days'].split(',').map(Number)
  const maxAttempts = parseInt(config['bot.followup.max_attempts'] || '3')
  const inp = 'w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200'

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><MessageCircle className="h-6 w-6" /> Follow-up Automatico</h1>
            <p className="text-sm text-gray-500">Mensagens automaticas quando o cliente nao responde</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleRestore} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border rounded-lg px-3 py-2">
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrao
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Section 1: Ativar/Desativar */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Follow-up Ativo</h2>
            <p className="text-sm text-gray-500 mt-0.5">Quando ativado, o bot envia mensagens automaticas para clientes que nao responderam</p>
          </div>
          <button
            type="button"
            onClick={() => upd('bot.followup.enabled', isEnabled ? 'false' : 'true')}
            className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', isEnabled ? 'bg-blue-600' : 'bg-gray-300')}
          >
            <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', isEnabled ? 'translate-x-6' : 'translate-x-1')} />
          </button>
        </div>
      </div>

      {/* Section 2: Timeline Visual */}
      {isEnabled && (
        <>
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Clock className="h-5 w-5 text-blue-500" /> Sequencia de Follow-up</h2>
            <p className="text-sm text-gray-500 mb-4">Configure ate 3 mensagens escalonadas. Cada uma e enviada se o cliente nao responder apos o intervalo definido.</p>

            {/* Max attempts */}
            <div className="mb-5">
              <label className="block text-xs text-gray-500 mb-1">Numero maximo de follow-ups</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(n => (
                  <button key={n} type="button" onClick={() => upd('bot.followup.max_attempts', String(n))}
                    className={cn('px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                      maxAttempts === n ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                    {n} mensagem{n > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>

            {/* Timeline items */}
            <div className="space-y-6">
              {[1, 2, 3].filter(n => n <= maxAttempts).map(n => {
                const intervalKey = `bot.followup.interval_${n}_minutes` as keyof FollowUpConfig
                const msgKey = `bot.followup.msg_${n}` as keyof FollowUpConfig
                const intervalValue = config[intervalKey] || '60'
                const colors = n === 1
                  ? { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', text: 'text-blue-700' }
                  : n === 2
                    ? { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', text: 'text-amber-700' }
                    : { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', text: 'text-red-700' }

                return (
                  <div key={n} className={cn('rounded-xl border p-4', colors.border, colors.bg)}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn('h-3 w-3 rounded-full', colors.dot)} />
                      <span className={cn('font-semibold text-sm', colors.text)}>Follow-up #{n}</span>
                      <span className="text-xs text-gray-500">— enviado {formatMinutes(parseInt(intervalValue))} apos silencio</span>
                    </div>

                    {/* Interval */}
                    <div className="mb-3">
                      <label className="block text-xs text-gray-500 mb-1">Intervalo de espera</label>
                      <div className="flex flex-wrap gap-1.5">
                        {INTERVAL_PRESETS.map(p => (
                          <button key={p.value} type="button" onClick={() => upd(intervalKey, p.value)}
                            className={cn('rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                              intervalValue === p.value ? `${colors.text} ${colors.bg} ${colors.border}` : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                            {p.label}
                          </button>
                        ))}
                        <div className="flex items-center gap-1">
                          <input type="number" min="5" value={intervalValue}
                            onChange={e => upd(intervalKey, e.target.value)}
                            className="w-20 px-2 py-1 border rounded-lg text-xs text-center" />
                          <span className="text-xs text-gray-400">min</span>
                        </div>
                      </div>
                    </div>

                    {/* Message */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Mensagem</label>
                      <textarea
                        value={config[msgKey]}
                        onChange={e => upd(msgKey, e.target.value)}
                        rows={3}
                        className={inp}
                        placeholder="Mensagem do follow-up..."
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">Variaveis: {'{{empresa}}'} {'{{suporte}}'}</p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Visual timeline summary */}
            <div className="mt-5 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs font-medium text-gray-500 mb-2">Resumo da sequencia:</p>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Cliente nao responde</span>
                {[1, 2, 3].filter(n => n <= maxAttempts).map(n => {
                  const intervalKey = `bot.followup.interval_${n}_minutes` as keyof FollowUpConfig
                  return (
                    <span key={n} className="flex items-center gap-1">
                      <span className="text-gray-400">→</span>
                      <span className="bg-white border px-2 py-0.5 rounded-full">{formatMinutes(parseInt(config[intervalKey] || '60'))}</span>
                      <span className="text-gray-400">→</span>
                      <span className={cn('px-2 py-0.5 rounded-full font-medium',
                        n === 1 ? 'bg-blue-100 text-blue-700' : n === 2 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
                        #{n}
                      </span>
                    </span>
                  )
                })}
                <span className="text-gray-400">→</span>
                <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">Encerra</span>
              </div>
            </div>
          </div>

          {/* Section 3: Horario Comercial */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Clock className="h-5 w-5 text-green-500" /> Horario Comercial</h2>
            <p className="text-sm text-gray-500 mb-4">Follow-ups so sao enviados no horario e dias permitidos. Mensagens fora do horario sao reagendadas automaticamente.</p>

            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-700">Respeitar horario comercial</span>
              <button
                type="button"
                onClick={() => upd('bot.followup.business_hours_only', config['bot.followup.business_hours_only'] === 'true' ? 'false' : 'true')}
                className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  config['bot.followup.business_hours_only'] === 'true' ? 'bg-green-500' : 'bg-gray-300')}
              >
                <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  config['bot.followup.business_hours_only'] === 'true' ? 'translate-x-6' : 'translate-x-1')} />
              </button>
            </div>

            {config['bot.followup.business_hours_only'] === 'true' && (
              <div className="space-y-4">
                {/* Hours */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Inicio (hora)</label>
                    <select value={config['bot.followup.business_hour_start']} onChange={e => upd('bot.followup.business_hour_start', e.target.value)} title="Hora inicio" className={inp}>
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fim (hora)</label>
                    <select value={config['bot.followup.business_hour_end']} onChange={e => upd('bot.followup.business_hour_end', e.target.value)} title="Hora fim" className={inp}>
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Days */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Dias permitidos</label>
                  <div className="flex gap-1.5">
                    {DAY_OPTIONS.map(d => (
                      <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                        className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                          activeDays.includes(d.value) ? 'bg-green-500 text-white border-green-500' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50')}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Opt-out */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><Shield className="h-5 w-5 text-red-500" /> Opt-out (Descadastro)</h2>
            <p className="text-sm text-gray-500 mb-4">Se o cliente enviar qualquer uma dessas palavras, os follow-ups param automaticamente. Conforme LGPD.</p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Palavras-chave (separadas por virgula)</label>
              <textarea
                value={config['bot.followup.opt_out_keywords']}
                onChange={e => upd('bot.followup.opt_out_keywords', e.target.value)}
                rows={2}
                className={inp}
                placeholder="parar, cancelar, sair, stop..."
              />
              <p className="text-[10px] text-gray-400 mt-0.5">O bot detecta essas palavras em qualquer parte da mensagem e para de enviar follow-ups</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
