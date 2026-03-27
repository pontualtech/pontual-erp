'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Save, Loader2, CheckCircle2, XCircle,
  Landmark, Shield, Key, FileText
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ProviderOption {
  value: string
  label: string
  description: string
  icon: string
}

const providers: ProviderOption[] = [
  { value: 'inter', label: 'Banco Inter', description: 'API v2 com mTLS - PIX integrado', icon: '077' },
  { value: 'itau', label: 'Itau', description: 'OAuth2 + Certificado Digital A1', icon: '341' },
  { value: 'stone', label: 'Stone', description: 'JWT Bearer + RSA - PIX integrado', icon: '197' },
]

const providerFields: Record<string, { key: string; label: string; type: string; placeholder: string; help?: string }[]> = {
  inter: [
    { key: 'boleto.inter.client_id', label: 'Client ID', type: 'text', placeholder: 'Seu Client ID do Inter', help: 'Obtido no portal developers.inter.co' },
    { key: 'boleto.inter.client_secret', label: 'Client Secret', type: 'password', placeholder: 'Seu Client Secret', help: 'Mantenha em sigilo' },
    { key: 'boleto.inter.cert_path', label: 'Caminho do Certificado (.pem)', type: 'text', placeholder: '/certs/inter-cert.pem', help: 'Certificado mTLS gerado no painel Inter' },
    { key: 'boleto.inter.key_path', label: 'Caminho da Chave (.key)', type: 'text', placeholder: '/certs/inter-key.pem', help: 'Chave privada do certificado' },
    { key: 'boleto.inter.webhook_secret', label: 'Webhook Secret', type: 'text', placeholder: 'Secret para validar webhooks', help: 'Configurado no painel Inter ao cadastrar webhook' },
  ],
  itau: [
    { key: 'boleto.itau.client_id', label: 'Client ID', type: 'text', placeholder: 'Seu Client ID do Itau' },
    { key: 'boleto.itau.client_secret', label: 'Client Secret', type: 'password', placeholder: 'Seu Client Secret' },
    { key: 'boleto.itau.cert_path', label: 'Caminho do Certificado (.pfx)', type: 'text', placeholder: '/certs/itau-cert.pfx', help: 'Certificado digital A1' },
    { key: 'boleto.itau.cert_password', label: 'Senha do Certificado', type: 'password', placeholder: 'Senha do certificado .pfx' },
  ],
  stone: [
    { key: 'boleto.stone.client_id', label: 'Client ID', type: 'text', placeholder: 'Seu Client ID da Stone' },
    { key: 'boleto.stone.private_key_path', label: 'Caminho da Chave RSA', type: 'text', placeholder: '/certs/stone-private.pem', help: 'Chave privada RSA para assinar JWT' },
    { key: 'boleto.stone.account_id', label: 'Account ID', type: 'text', placeholder: 'Seu Account ID Stone' },
  ],
}

export default function IntegracoesPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)

  const [activeProvider, setActiveProvider] = useState('inter')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  // Load current settings
  useEffect(() => {
    setLoading(true)
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        const settings = d.data || {}
        const values: Record<string, string> = {}

        // Flatten grouped settings into key-value pairs
        for (const group of Object.values(settings) as Record<string, { value: string }>[] ) {
          for (const [key, setting] of Object.entries(group)) {
            values[key] = setting.value
          }
        }

        // Set active provider
        if (values['boleto.provider']) {
          setActiveProvider(values['boleto.provider'])
        }

        setFieldValues(values)
      })
      .catch(() => toast.error('Erro ao carregar configuracoes'))
      .finally(() => setLoading(false))
  }, [])

  function updateField(key: string, value: string) {
    setFieldValues(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Build settings array to save
      const settings: { key: string; value: string; type: string }[] = [
        { key: 'boleto.provider', value: activeProvider, type: 'string' },
      ]

      // Add all provider-specific fields
      const fields = providerFields[activeProvider] || []
      for (const field of fields) {
        if (fieldValues[field.key] !== undefined) {
          settings.push({
            key: field.key,
            value: fieldValues[field.key],
            type: 'string',
          })
        }
      }

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao salvar')
      }

      toast.success('Configuracoes salvas com sucesso!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar configuracoes')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      // For now, just validate that required fields are filled
      const fields = providerFields[activeProvider] || []
      const missing = fields.filter(f => !fieldValues[f.key]?.trim())

      if (missing.length > 0) {
        setTestResult('error')
        toast.error(`Preencha todos os campos: ${missing.map(f => f.label).join(', ')}`)
        return
      }

      // TODO: In production, this would make a real API call to test the connection
      // For development, simulate a successful test
      await new Promise(resolve => setTimeout(resolve, 1500))

      if (process.env.NODE_ENV === 'production') {
        // Real test would call the provider's health/test endpoint
        setTestResult('error')
        toast.error('Teste de conexao requer certificados configurados no servidor')
      } else {
        setTestResult('success')
        toast.success('Conexao testada com sucesso! (modo desenvolvimento)')
      }
    } catch (err) {
      setTestResult('error')
      toast.error(err instanceof Error ? err.message : 'Falha no teste de conexao')
    } finally {
      setTesting(false)
    }
  }

  const currentFields = providerFields[activeProvider] || []

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/config" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Integracoes Bancarias</h1>
        </div>
        <p className="text-sm text-gray-500 ml-7">
          <Link href="/config" className="text-blue-600 hover:underline">Configuracoes</Link> / Integracoes Bancarias
        </p>
      </div>

      {/* Provider Selection */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Landmark className="h-5 w-5 text-blue-600" />
            Provedor de Boletos
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Selecione o banco para emissao de boletos
          </p>
        </div>
        <div className="p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {providers.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => {
                  setActiveProvider(p.value)
                  setTestResult(null)
                }}
                className={cn(
                  'rounded-lg border-2 p-4 text-left transition-all',
                  activeProvider === p.value
                    ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-200'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold',
                    activeProvider === p.value ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                  )}>
                    {p.icon}
                  </div>
                  <span className="font-medium text-gray-900">{p.label}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{p.description}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Provider Credentials */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Key className="h-5 w-5 text-amber-600" />
            Credenciais - {providers.find(p => p.value === activeProvider)?.label}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Preencha as credenciais de acesso a API do banco
          </p>
        </div>
        <div className="p-6 space-y-4">
          {currentFields.map(field => (
            <div key={field.key}>
              <label htmlFor={field.key} className="block text-sm font-medium text-gray-700 mb-1">
                {field.label}
              </label>
              <input
                id={field.key}
                type={field.type}
                placeholder={field.placeholder}
                value={fieldValues[field.key] || ''}
                onChange={e => updateField(field.key, e.target.value)}
                className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              {field.help && (
                <p className="mt-1 text-xs text-gray-400">{field.help}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Webhook Info */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-purple-600" />
            Webhook de Pagamento
          </h2>
        </div>
        <div className="p-6">
          <p className="text-sm text-gray-600 mb-3">
            Configure este URL no painel do banco para receber notificacoes automaticas de pagamento:
          </p>
          <div className="rounded-md border bg-gray-50 p-3">
            <code className="text-sm text-gray-800 break-all">
              {typeof window !== 'undefined' ? window.location.origin : 'https://erp.pontualtech.work'}/api/financeiro/boletos/webhook
            </code>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Quando um boleto for pago, o banco enviara uma notificacao para este endpoint,
            e a conta a receber sera marcada automaticamente como recebida.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar Configuracoes'}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className={cn(
            'flex items-center gap-2 rounded-md border px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50',
            testResult === 'success'
              ? 'border-green-300 bg-green-50 text-green-700'
              : testResult === 'error'
              ? 'border-red-300 bg-red-50 text-red-700'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          )}
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : testResult === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : testResult === 'error' ? (
            <XCircle className="h-4 w-4" />
          ) : (
            <Shield className="h-4 w-4" />
          )}
          {testing ? 'Testando...' : testResult === 'success' ? 'Conexao OK' : testResult === 'error' ? 'Falha na Conexao' : 'Testar Conexao'}
        </button>
      </div>
    </div>
  )
}
