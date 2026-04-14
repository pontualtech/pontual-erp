'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, MessageCircle, Clock, Shield, RotateCcw, Power } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const DAY_OPTIONS = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sab' },
]

const COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', text: 'text-blue-700' },
  { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', text: 'text-amber-700' },
  { bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-500', text: 'text-orange-700' },
  { bg: 'bg-purple-50', border: 'border-purple-200', dot: 'bg-purple-500', text: 'text-purple-700' },
  { bg: 'bg-pink-50', border: 'border-pink-200', dot: 'bg-pink-500', text: 'text-pink-700' },
  { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', text: 'text-red-700' },
]

function formatInterval(m: number): string {
  if (m < 60) return `${m} min`
  if (m < 1440) {
    const h = Math.floor(m / 60)
    return `${h}h`
  }
  const d = Math.round(m / 1440)
  if (d === 7) return '1 semana'
  if (d === 14) return '2 semanas'
  if (d >= 28 && d <= 31) return '1 mes'
  return `${d} dias`
}

// Convert minutes to human-readable input value
function minsToTimeStr(mins: string): string {
  const m = parseInt(mins) || 60
  if (m < 60) return mins
  if (m < 1440) return String(Math.round(m / 60))
  return String(Math.round(m / 1440))
}

function minsToUnit(mins: string): string {
  const m = parseInt(mins) || 60
  if (m < 60) return 'min'
  if (m < 1440) return 'horas'
  return 'dias'
}

function timeToMins(value: string, unit: string): string {
  const n = parseInt(value) || 1
  if (unit === 'min') return String(n)
  if (unit === 'horas') return String(n * 60)
  return String(n * 1440)
}

export default function BotFollowUpConfigPage() {
  const [config, setConfig] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/bot-followup')
      .then(r => r.json())
      .then(d => { if (d.data) setConfig(d.data) })
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [])

  function upd(key: string, value: string) {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/bot-followup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      toast.success('Configuracoes salvas!')
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  function toggleDay(day: number) {
    const current = (config['bot.followup.business_days'] || '1,2,3,4,5').split(',').map(Number).filter(n => !isNaN(n))
    const updated = current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort()
    upd('bot.followup.business_days', updated.join(','))
  }

  const isEnabled = config['bot.followup.enabled'] === 'true'
  const maxAttempts = parseInt(config['bot.followup.max_attempts'] || '3')
  const activeDays = (config['bot.followup.business_days'] || '1,2,3,4,5').split(',').map(Number)
  const inp = 'w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200'

  // Toggle a specific follow-up on/off by adjusting max_attempts
  function toggleFollowUp(n: number) {
    if (n <= maxAttempts) {
      // Turning off: set max to n-1
      upd('bot.followup.max_attempts', String(n - 1))
    } else {
      // Turning on: set max to n
      upd('bot.followup.max_attempts', String(n))
    }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...</div>

  return (
    <div className="space-y-5 max-w-4xl pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><MessageCircle className="h-6 w-6" /> Follow-up Automatico</h1>
            <p className="text-sm text-gray-500">Mensagens automaticas quando o cliente nao responde</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Toggle global */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Follow-up Ativo</h2>
            <p className="text-sm text-gray-500 mt-0.5">O bot envia mensagens automaticas para clientes que nao responderam</p>
          </div>
          <button type="button" onClick={() => upd('bot.followup.enabled', isEnabled ? 'false' : 'true')}
            className={cn('relative inline-flex h-7 w-12 items-center rounded-full transition-colors', isEnabled ? 'bg-blue-600' : 'bg-gray-300')}>
            <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow', isEnabled ? 'translate-x-6' : 'translate-x-1')} />
          </button>
        </div>
      </div>

      {isEnabled && (
        <>
          {/* 6 Follow-up cards */}
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6].map(n => {
              const color = COLORS[n - 1]
              const isActive = n <= maxAttempts
              const intervalMins = config[`bot.followup.interval_${n}_minutes`] || '60'
              const msg = config[`bot.followup.msg_${n}`] || ''

              return (
                <div key={n} className={cn('rounded-xl border transition-all', isActive ? `${color.border} ${color.bg}` : 'border-gray-200 bg-gray-50 opacity-60')}>
                  {/* Header with toggle */}
                  <div className="flex items-center justify-between p-4 pb-0">
                    <div className="flex items-center gap-2">
                      <div className={cn('h-3 w-3 rounded-full', isActive ? color.dot : 'bg-gray-300')} />
                      <span className={cn('font-semibold text-sm', isActive ? color.text : 'text-gray-400')}>
                        Follow-up #{n}
                      </span>
                      {isActive && (
                        <span className="text-xs text-gray-500">— {formatInterval(parseInt(intervalMins))} apos silencio</span>
                      )}
                      {!isActive && (
                        <span className="text-xs text-gray-400">— desligado</span>
                      )}
                    </div>
                    <button type="button" title={isActive ? 'Desligar' : 'Ligar'} onClick={() => toggleFollowUp(n)}
                      className={cn('relative inline-flex h-6 w-10 items-center rounded-full transition-colors',
                        isActive ? 'bg-green-500' : 'bg-gray-300')}>
                      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm',
                        isActive ? 'translate-x-5' : 'translate-x-1')} />
                    </button>
                  </div>

                  {/* Content (only when active) */}
                  {isActive && (
                    <div className="p-4 pt-3 space-y-3">
                      {/* Interval */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Enviar apos</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            title="Valor do intervalo"
                            value={minsToTimeStr(intervalMins)}
                            onChange={e => upd(`bot.followup.interval_${n}_minutes`, timeToMins(e.target.value, minsToUnit(intervalMins)))}
                            className="w-20 px-3 py-2 border rounded-lg text-sm text-center font-medium"
                          />
                          <select
                            title="Unidade de tempo"
                            value={minsToUnit(intervalMins)}
                            onChange={e => upd(`bot.followup.interval_${n}_minutes`, timeToMins(minsToTimeStr(intervalMins), e.target.value))}
                            className="px-3 py-2 border rounded-lg text-sm bg-white"
                          >
                            <option value="min">minutos</option>
                            <option value="horas">horas</option>
                            <option value="dias">dias</option>
                          </select>
                          <span className="text-xs text-gray-400">sem resposta do cliente</span>
                        </div>
                      </div>

                      {/* Message */}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Mensagem</label>
                        <textarea
                          value={msg}
                          onChange={e => upd(`bot.followup.msg_${n}`, e.target.value)}
                          rows={3}
                          className={inp}
                          placeholder="Mensagem do follow-up..."
                        />
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Use *texto* para negrito no WhatsApp. Variaveis: {'{{empresa}}'} {'{{suporte}}'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Resumo visual */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500 mb-2">Resumo da sequencia ativa:</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
              <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Bot responde</span>
              {[1, 2, 3, 4, 5, 6].filter(n => n <= maxAttempts).map(n => {
                const mins = config[`bot.followup.interval_${n}_minutes`] || '60'
                return (
                  <span key={n} className="flex items-center gap-1">
                    <span className="text-gray-400">→</span>
                    <span className="bg-white border px-2 py-0.5 rounded-full">{formatInterval(parseInt(mins))}</span>
                    <span className="text-gray-400">→</span>
                    <span className={cn('px-2 py-0.5 rounded-full font-medium', COLORS[n - 1].bg, COLORS[n - 1].text)}>#{n}</span>
                  </span>
                )
              })}
              <span className="text-gray-400">→</span>
              <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">Encerra</span>
            </div>
            {maxAttempts === 0 && <p className="text-xs text-gray-400 mt-1">Nenhum follow-up ativo</p>}
          </div>

          {/* Horario Comercial */}
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Clock className="h-5 w-5 text-green-500" /> Horario Comercial</h2>
                <p className="text-sm text-gray-500 mt-0.5">Follow-ups so sao enviados no horario e dias permitidos</p>
              </div>
              <button type="button"
                onClick={() => upd('bot.followup.business_hours_only', config['bot.followup.business_hours_only'] === 'true' ? 'false' : 'true')}
                className={cn('relative inline-flex h-6 w-10 items-center rounded-full transition-colors',
                  config['bot.followup.business_hours_only'] === 'true' ? 'bg-green-500' : 'bg-gray-300')}>
                <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm',
                  config['bot.followup.business_hours_only'] === 'true' ? 'translate-x-5' : 'translate-x-1')} />
              </button>
            </div>

            {config['bot.followup.business_hours_only'] === 'true' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Inicio</label>
                    <input type="time" title="Hora inicio"
                      value={`${String(config['bot.followup.business_hour_start'] || '8').padStart(2, '0')}:00`}
                      onChange={e => upd('bot.followup.business_hour_start', String(parseInt(e.target.value.split(':')[0]) || 0))}
                      className={inp} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fim</label>
                    <input type="time" title="Hora fim"
                      value={`${String(config['bot.followup.business_hour_end'] || '18').padStart(2, '0')}:00`}
                      onChange={e => upd('bot.followup.business_hour_end', String(parseInt(e.target.value.split(':')[0]) || 0))}
                      className={inp} />
                  </div>
                </div>
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

          {/* Opt-out */}
          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2"><Shield className="h-5 w-5 text-red-500" /> Opt-out (LGPD)</h2>
            <p className="text-sm text-gray-500 mb-3">Se o cliente enviar essas palavras, os follow-ups param automaticamente</p>
            <textarea
              value={config['bot.followup.opt_out_keywords'] || ''}
              onChange={e => upd('bot.followup.opt_out_keywords', e.target.value)}
              rows={2}
              className={inp}
              placeholder="parar, cancelar, sair, stop..."
            />
          </div>
        </>
      )}
    </div>
  )
}
