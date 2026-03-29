'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/use-auth'
import { ArrowLeft, Save, Search, ExternalLink, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

export default function ConfigConsultaCpfPage() {
  const { isAdmin } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testCpf, setTestCpf] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const all = data.data || {}
        const cpfApi = all.cpf_api || {}
        if (cpfApi['cpf_api.enabled']) setEnabled(cpfApi['cpf_api.enabled'].value === 'true')
        if (cpfApi['cpf_api.token']) setToken(cpfApi['cpf_api.token'].value || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: [
            { key: 'cpf_api.enabled', value: String(enabled), type: 'boolean' },
            { key: 'cpf_api.token', value: token, type: 'string' },
          ],
        }),
      })
      toast.success('Configuracao salva!')
    } catch { toast.error('Erro ao salvar') }
    finally { setSaving(false) }
  }

  async function handleTest() {
    const digits = testCpf.replace(/\D/g, '')
    if (digits.length !== 11) { toast.error('Digite um CPF valido com 11 digitos'); return }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`/api/consulta/cpf/${digits}`)
      const data = await res.json()
      if (res.ok && data.data) {
        setTestResult(`Nome: ${data.data.legal_name}\nSituacao: ${data.data.situacao}`)
      } else {
        setTestResult(`Erro: ${data.error}`)
      }
    } catch { setTestResult('Erro de conexao') }
    finally { setTesting(false) }
  }

  if (!isAdmin) return <div className="p-8 text-center text-sm text-gray-400">Apenas administradores.</div>
  if (loading) return <div className="p-8 text-center text-sm text-gray-400">Carregando...</div>

  const inp = 'w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-sm'

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Search className="h-6 w-6" /> Consulta CPF
          </h1>
          <p className="text-sm text-gray-500">Preencher nome automaticamente ao digitar CPF no cadastro de cliente</p>
        </div>
      </div>

      {/* Ativar/Desativar */}
      <div className="rounded-lg border bg-white dark:bg-gray-800 p-6 shadow-sm space-y-5">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
            className="rounded border-gray-300 h-5 w-5" />
          <div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Ativar consulta automatica de CPF
            </span>
            <p className="text-xs text-gray-400">
              Quando ativado, ao digitar um CPF no cadastro de cliente o sistema busca o nome automaticamente
            </p>
          </div>
        </label>

        {/* Token */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Token da API (cpfcnpj.com.br)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type={showToken ? 'text' : 'password'} value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Cole seu token aqui..."
                className={inp + ' pr-10'} />
              <button type="button" onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span>Obtenha seu token em</span>
            <a href="https://www.cpfcnpj.com.br" target="_blank" rel="noopener noreferrer"
              className="text-blue-500 hover:underline flex items-center gap-1">
              cpfcnpj.com.br <ExternalLink className="h-3 w-3" />
            </a>
            <span>— Plano a partir de R$ 29/mes</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            <Save className="h-4 w-4" /> {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Testar */}
      {enabled && token && (
        <div className="rounded-lg border bg-white dark:bg-gray-800 p-6 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">Testar Consulta</h2>
          <div className="flex gap-2">
            <input type="text" value={testCpf} onChange={e => setTestCpf(e.target.value)}
              placeholder="Digite um CPF para testar..." maxLength={14}
              className={inp + ' max-w-xs'} />
            <button onClick={handleTest} disabled={testing}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              <Search className="h-4 w-4" /> {testing ? 'Consultando...' : 'Testar'}
            </button>
          </div>
          {testResult && (
            <pre className="text-sm bg-gray-50 dark:bg-gray-700 rounded-lg p-3 whitespace-pre-wrap">
              {testResult}
            </pre>
          )}
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 dark:bg-blue-900/20 p-4 text-sm text-blue-700 dark:text-blue-300">
        <p className="font-medium mb-1">Como funciona:</p>
        <ul className="list-disc pl-5 space-y-1 text-blue-600 dark:text-blue-400">
          <li>O CNPJ continua sendo consultado gratuitamente (ReceitaWS)</li>
          <li>O CPF usa a API paga cpfcnpj.com.br (requer token)</li>
          <li>Ao digitar CPF no cadastro de cliente, o nome e preenchido automaticamente</li>
          <li>Se desativado, o CPF funciona normalmente mas sem auto-preenchimento</li>
        </ul>
      </div>
    </div>
  )
}
