'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Save, Loader2, CheckCircle2, XCircle,
  Shield, Key, FileText, Settings, Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface FiscalConfigData {
  id: string
  provider: string | null
  api_key: string | null
  has_api_key: boolean
  environment: string | null
  settings: Record<string, any> | null
}

export default function FiscalConfigPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [testMessage, setTestMessage] = useState('')

  // Config values
  const [provider, setProvider] = useState('focus_nfe')
  const [apiKey, setApiKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [environment, setEnvironment] = useState<'homologacao' | 'producao'>('homologacao')

  // Settings
  const [cnpj, setCnpj] = useState('')
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('')
  const [codigoMunicipio, setCodigoMunicipio] = useState('3550308')
  const [codigoServicoPadrao, setCodigoServicoPadrao] = useState('0107')
  const [aliquotaPadrao, setAliquotaPadrao] = useState('2.9')

  // Load config
  useEffect(() => {
    setLoading(true)
    fetch('/api/fiscal/config')
      .then(r => r.json())
      .then(d => {
        const cfg = d.data as FiscalConfigData
        if (cfg) {
          setProvider(cfg.provider || 'focus_nfe')
          setApiKey(cfg.api_key || '')
          setHasApiKey(cfg.has_api_key)
          setEnvironment((cfg.environment as 'homologacao' | 'producao') || 'homologacao')

          const settings = cfg.settings || {}
          setCnpj(settings.cnpj || '')
          setInscricaoMunicipal(settings.inscricaoMunicipal || '')
          setCodigoMunicipio(settings.codigoMunicipio || '3550308')
          setCodigoServicoPadrao(settings.codigoServicoPadrao || '0107')
          setAliquotaPadrao(String(settings.aliquotaPadrao ?? 2.9))
        }
      })
      .catch(() => toast.error('Erro ao carregar configuracoes fiscais'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const body: any = {
        provider,
        environment,
        settings: {
          cnpj,
          inscricaoMunicipal,
          codigoMunicipio,
          codigoServicoPadrao,
          aliquotaPadrao: parseFloat(aliquotaPadrao.replace(',', '.')) || 2.9,
        },
      }

      // Only send API key if user typed a new one (not masked)
      if (apiKey && !apiKey.includes('*')) {
        body.api_key = apiKey
      }

      const res = await fetch('/api/fiscal/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erro ao salvar')
      }

      const data = await res.json()
      const cfg = data.data as FiscalConfigData
      setApiKey(cfg.api_key || '')
      setHasApiKey(cfg.has_api_key)

      toast.success('Configuracoes fiscais salvas com sucesso!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar configuracoes')
    } finally {
      setSaving(false)
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    setTestMessage('')

    try {
      const body: any = { environment }
      // Send api_key only if it's a new/unmasked value
      if (apiKey && !apiKey.includes('*')) {
        body.api_key = apiKey
      }

      const res = await fetch('/api/fiscal/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (res.ok && data.data?.ok) {
        setTestResult('success')
        setTestMessage(data.data.message || 'Conexao OK')
        toast.success(data.data.message || 'Conexao estabelecida com sucesso!')
      } else {
        setTestResult('error')
        setTestMessage(data.data?.message || data.error || 'Falha na conexao')
        toast.error(data.data?.message || data.error || 'Falha na conexao')
      }
    } catch (err) {
      setTestResult('error')
      setTestMessage('Erro de conexao com o servidor')
      toast.error('Erro de conexao com o servidor')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/fiscal" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Configuracoes Fiscais</h1>
        </div>
        <p className="text-sm text-gray-500 ml-7">
          <Link href="/fiscal" className="text-blue-600 hover:underline">Fiscal</Link> / Configuracoes
        </p>
      </div>

      {/* Provider */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Provedor Fiscal
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Selecione o provedor para emissao de notas fiscais de servico
          </p>
        </div>
        <div className="p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setProvider('focus_nfe')}
              className={cn(
                'rounded-lg border-2 p-4 text-left transition-all',
                provider === 'focus_nfe'
                  ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-200'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold',
                  provider === 'focus_nfe' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                )}>
                  FN
                </div>
                <span className="font-medium text-gray-900">Focus NFe</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                API REST para NFS-e, NF-e, NFC-e. Suporte a todos municipios.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setProvider('prefeitura_sp')}
              className={cn(
                'rounded-lg border-2 p-4 text-left transition-all',
                provider === 'prefeitura_sp'
                  ? 'border-green-500 bg-green-50/50 ring-1 ring-green-200'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold',
                  provider === 'prefeitura_sp' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                )}>
                  SP
                </div>
                <span className="font-medium text-gray-900">Prefeitura de SP</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Web Service oficial gratuito. Requer certificado A1. Apenas Sao Paulo.
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* API Key & Environment */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Key className="h-5 w-5 text-amber-600" />
            {provider === 'prefeitura_sp' ? 'Certificado e Ambiente' : 'Credenciais da API'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {provider === 'prefeitura_sp'
              ? 'Certificado A1 e ambiente da Prefeitura de SP'
              : 'Token de acesso e ambiente do Focus NFe'}
          </p>
        </div>
        <div className="p-6 space-y-4">
          {provider === 'prefeitura_sp' ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-medium text-green-800">Integracao direta com a Prefeitura de SP</p>
              <p className="text-xs text-green-700 mt-1">
                Nao precisa de API key. Requer certificado digital A1 (.pfx) instalado.
              </p>
              <Link href="/config/certificado" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 underline">
                <Shield className="h-3.5 w-3.5" /> Gerenciar Certificado A1
              </Link>
            </div>
          ) : (
            <div>
              <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
                API Key / Token
              </label>
              <input
                id="apiKey"
                type="password"
                placeholder={hasApiKey ? 'API key configurada (digite para alterar)' : 'Cole sua API key do Focus NFe aqui'}
                value={apiKey}
                onChange={e => { setApiKey(e.target.value); setTestResult(null) }}
                className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Obtida no painel Focus NFe: app.focusnfe.com.br
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ambiente
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setEnvironment('homologacao'); setTestResult(null) }}
                className={cn(
                  'flex-1 rounded-lg border-2 p-3 text-center text-sm font-medium transition-all',
                  environment === 'homologacao'
                    ? 'border-yellow-400 bg-yellow-50 text-yellow-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                Homologacao (Testes)
              </button>
              <button
                type="button"
                onClick={() => { setEnvironment('producao'); setTestResult(null) }}
                className={cn(
                  'flex-1 rounded-lg border-2 p-3 text-center text-sm font-medium transition-all',
                  environment === 'producao'
                    ? 'border-green-400 bg-green-50 text-green-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                )}
              >
                Producao
              </button>
            </div>
            {environment === 'producao' && (
              <p className="mt-2 text-xs text-red-500 font-medium">
                Atencao: Notas emitidas em producao sao REAIS e tem valor fiscal.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Prestador (Company Data) */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-purple-600" />
            Dados do Prestador
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Informacoes da sua empresa para emissao de NFS-e
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cnpj" className="block text-sm font-medium text-gray-700 mb-1">
                CNPJ
              </label>
              <input
                id="cnpj"
                type="text"
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={e => setCnpj(e.target.value)}
                className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="inscricaoMunicipal" className="block text-sm font-medium text-gray-700 mb-1">
                Inscricao Municipal
              </label>
              <input
                id="inscricaoMunicipal"
                type="text"
                placeholder="Numero da inscricao municipal"
                value={inscricaoMunicipal}
                onChange={e => setInscricaoMunicipal(e.target.value)}
                className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="codigoMunicipio" className="block text-sm font-medium text-gray-700 mb-1">
              Codigo Municipio (IBGE)
            </label>
            <input
              id="codigoMunicipio"
              type="text"
              placeholder="3550308"
              value={codigoMunicipio}
              onChange={e => setCodigoMunicipio(e.target.value)}
              className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              Codigo IBGE do municipio. Ex: 3550308 para Sao Paulo/SP
            </p>
          </div>
        </div>
      </div>

      {/* Default Values */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-600" />
            Valores Padrao
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Valores pre-preenchidos na emissao de NFS-e (podem ser alterados a cada emissao)
          </p>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="codigoServicoPadrao" className="block text-sm font-medium text-gray-700 mb-1">
                Codigo Servico Padrao
              </label>
              <input
                id="codigoServicoPadrao"
                type="text"
                placeholder="0107"
                value={codigoServicoPadrao}
                onChange={e => setCodigoServicoPadrao(e.target.value)}
                className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Item da lista de servicos (LC 116/03). Ex: 0107 = Suporte tecnico
              </p>
            </div>

            <div>
              <label htmlFor="aliquotaPadrao" className="block text-sm font-medium text-gray-700 mb-1">
                Aliquota ISS Padrao (%)
              </label>
              <input
                id="aliquotaPadrao"
                type="text"
                placeholder="2.9"
                value={aliquotaPadrao}
                onChange={e => setAliquotaPadrao(e.target.value)}
                className="w-full rounded-md border bg-white py-2 px-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">
                Aliquota padrao do ISS para servicos no municipio
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Test result message */}
      {testResult && (
        <div className={cn(
          'rounded-md border px-4 py-3 text-sm flex items-center gap-2',
          testResult === 'success'
            ? 'border-green-300 bg-green-50 text-green-800'
            : 'border-red-300 bg-red-50 text-red-800'
        )}>
          {testResult === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          {testMessage}
        </div>
      )}

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
          onClick={handleTestConnection}
          disabled={testing || (!hasApiKey && !apiKey)}
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
          {testing
            ? 'Testando...'
            : testResult === 'success'
            ? 'Conexao OK'
            : testResult === 'error'
            ? 'Falha na Conexao'
            : 'Testar Conexao'
          }
        </button>
      </div>
    </div>
  )
}
