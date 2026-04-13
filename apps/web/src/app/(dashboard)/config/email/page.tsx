'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, Mail, Send, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

interface EmailConfig {
  'email.provider': string
  'email.from_name': string
  'email.from_address': string
  'email.resend_api_key': string
  'email.smtp_host': string
  'email.smtp_port': string
  'email.smtp_user': string
  'email.smtp_pass': string
  'email.smtp_secure': string
  '_global_resend_configured': string
}

const SMTP_PRESETS: Record<string, { host: string; port: string; secure: string }> = {
  hostinger: { host: 'smtp.hostinger.com', port: '465', secure: 'true' },
  gmail: { host: 'smtp.gmail.com', port: '587', secure: 'false' },
  outlook: { host: 'smtp-mail.outlook.com', port: '587', secure: 'false' },
  zoho: { host: 'smtp.zoho.com', port: '465', secure: 'true' },
}

export default function EmailConfigPage() {
  const [config, setConfig] = useState<EmailConfig>({
    'email.provider': 'resend',
    'email.from_name': '',
    'email.from_address': '',
    'email.resend_api_key': '',
    'email.smtp_host': '',
    'email.smtp_port': '587',
    'email.smtp_user': '',
    'email.smtp_pass': '',
    'email.smtp_secure': 'false',
    '_global_resend_configured': 'false',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [showPass, setShowPass] = useState(false)

  useEffect(() => {
    fetch('/api/settings/email-config')
      .then(r => r.json())
      .then(d => { if (d.data) setConfig(prev => ({ ...prev, ...d.data })) })
      .catch(() => toast.error('Erro ao carregar configuracoes'))
      .finally(() => setLoading(false))
  }, [])

  function upd(key: string, value: string) {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  function applyPreset(preset: string) {
    const p = SMTP_PRESETS[preset]
    if (!p) return
    upd('email.smtp_host', p.host)
    upd('email.smtp_port', p.port)
    upd('email.smtp_secure', p.secure)
    toast.success(`Preset ${preset} aplicado`)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/email-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      toast.success('Configuracoes de email salvas!')
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function handleTest() {
    if (!testEmail) { toast.error('Digite um email para teste'); return }
    setTesting(true)
    try {
      // Save first, then test
      await handleSave()
      const res = await fetch('/api/settings/email-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      })
      const d = await res.json()
      if (res.ok) toast.success(d.data?.message || 'Email enviado!')
      else toast.error(d.error || 'Falha no envio')
    } catch (err: any) { toast.error(err.message) }
    finally { setTesting(false) }
  }

  const inp = 'w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100'
  const isSmtp = config['email.provider'] === 'smtp'

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Mail className="h-6 w-6" /> Configuracao de Email</h1>
            <p className="text-sm text-gray-500">Defina como os emails da empresa sao enviados</p>
          </div>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {/* Provider Selection */}
      <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Provedor de Email</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => upd('email.provider', 'resend')}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${!isSmtp ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}
          >
            <div className="font-medium text-gray-900 dark:text-gray-100">Resend API</div>
            <p className="text-xs text-gray-500 mt-1">Servico de email na nuvem. Facil de configurar, alta entregabilidade. Precisa verificar o dominio no Resend.</p>
            {config._global_resend_configured === 'true' && !isSmtp && (
              <div className="mt-2 flex items-center gap-1 text-xs text-green-600"><CheckCircle className="h-3 w-3" /> API Key global configurada</div>
            )}
          </button>
          <button
            type="button"
            onClick={() => upd('email.provider', 'smtp')}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${isSmtp ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}
          >
            <div className="font-medium text-gray-900 dark:text-gray-100">SMTP Proprio</div>
            <p className="text-xs text-gray-500 mt-1">Use o servidor de email da sua hospedagem (Hostinger, Gmail, Outlook, etc). Emails saem do seu dominio.</p>
          </button>
        </div>
      </div>

      {/* Sender Info */}
      <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Remetente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nome do Remetente</label>
            <input value={config['email.from_name']} onChange={e => upd('email.from_name', e.target.value)} placeholder="Imprimi Tech" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email do Remetente</label>
            <input type="email" value={config['email.from_address']} onChange={e => upd('email.from_address', e.target.value)} placeholder="contato@suaempresa.com.br" className={inp} />
          </div>
        </div>
      </div>

      {/* Resend Config */}
      {!isSmtp && (
        <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Resend API</h2>
          <div>
            <label className="block text-xs text-gray-500 mb-1">API Key</label>
            <input value={config['email.resend_api_key']} onChange={e => upd('email.resend_api_key', e.target.value)} placeholder="re_xxxxxxxxxx..." className={inp} />
            <p className="mt-1 text-xs text-gray-400">Se vazio, usa a API Key global do sistema. Para dominio proprio, crie uma key no resend.com</p>
          </div>
          {config._global_resend_configured === 'true' && (
            <div className="mt-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 p-3 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-800 dark:text-green-300">API Key global do sistema esta configurada como fallback</span>
            </div>
          )}
        </div>
      )}

      {/* SMTP Config */}
      {isSmtp && (
        <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Servidor SMTP</h2>
            <div className="flex gap-2">
              {Object.keys(SMTP_PRESETS).map(p => (
                <button key={p} type="button" onClick={() => applyPreset(p)}
                  className="rounded border px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 capitalize">{p}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Host SMTP</label>
              <input value={config['email.smtp_host']} onChange={e => upd('email.smtp_host', e.target.value)} placeholder="smtp.hostinger.com" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Porta</label>
              <input value={config['email.smtp_port']} onChange={e => upd('email.smtp_port', e.target.value)} placeholder="587" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Usuario SMTP</label>
              <input value={config['email.smtp_user']} onChange={e => upd('email.smtp_user', e.target.value)} placeholder="email@suaempresa.com.br" className={inp} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Senha SMTP</label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={config['email.smtp_pass']} onChange={e => upd('email.smtp_pass', e.target.value)} placeholder="senha" className={inp + ' pr-10'} />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-2 top-2 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={config['email.smtp_secure'] === 'true'} onChange={e => upd('email.smtp_secure', e.target.checked ? 'true' : 'false')} className="h-4 w-4 rounded border-gray-300" />
                SSL/TLS (porta 465)
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Test Email */}
      <div className="rounded-lg border bg-white dark:bg-gray-900 dark:border-gray-700 p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Testar Envio</h2>
        <div className="flex gap-3">
          <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="seu@email.com" className={inp + ' flex-1'} />
          <button type="button" onClick={handleTest} disabled={testing}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {testing ? 'Enviando...' : 'Enviar Teste'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">Salva as configuracoes e envia um email de teste para verificar se tudo esta funcionando.</p>
      </div>
    </div>
  )
}
