'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, Send, Loader2, FileText, Search,
  CheckCircle2, XCircle, Eye, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

interface Cliente {
  id: string
  legal_name: string
  document_number: string | null
  address_street: string | null
  address_number: string | null
  address_neighborhood: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
}

interface OS {
  id: string
  os_number: number
  equipment_type: string
  customers: { legal_name: string } | null
}

interface FiscalConfig {
  has_api_key: boolean
  environment: string | null
  settings: {
    codigoServicoPadrao?: string
    aliquotaPadrao?: number
    codigoMunicipio?: string
  } | null
}

interface EmissionResult {
  id: string
  status: string
  invoice_number: number | null
  access_key: string | null
  danfe_url: string | null
  xml_url: string | null
  provider_ref: string | null
  total_amount: number
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function parseCurrencyInput(value: string): number {
  // Remove tudo exceto digitos e virgula/ponto
  const cleaned = value.replace(/[^\d.,]/g, '')
  // Substitui virgula por ponto para parsing
  const normalized = cleaned.replace(',', '.')
  const parsed = parseFloat(normalized)
  if (isNaN(parsed)) return 0
  // Converte para centavos
  return Math.round(parsed * 100)
}

export default function EmitirNfsePage() {
  const [config, setConfig] = useState<FiscalConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)

  // Customer
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [clienteSearch, setClienteSearch] = useState('')
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null)
  const [showClienteDropdown, setShowClienteDropdown] = useState(false)

  // OS (optional)
  const [osList, setOsList] = useState<OS[]>([])
  const [osSearch, setOsSearch] = useState('')
  const [selectedOs, setSelectedOs] = useState<OS | null>(null)
  const [showOsDropdown, setShowOsDropdown] = useState(false)

  // Service data
  const [descricao, setDescricao] = useState('')
  const [valorDisplay, setValorDisplay] = useState('')
  const [valorCentavos, setValorCentavos] = useState(0)
  const [codigoServico, setCodigoServico] = useState('')
  const [aliquota, setAliquota] = useState('')
  const [issRetido, setIssRetido] = useState(false)

  // UI state
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [emissionResult, setEmissionResult] = useState<EmissionResult | null>(null)
  const [emissionError, setEmissionError] = useState<string | null>(null)

  // Load fiscal config
  useEffect(() => {
    fetch('/api/fiscal/config')
      .then(r => r.json())
      .then(d => {
        const cfg = d.data
        setConfig(cfg)
        const settings = cfg?.settings || {}
        setCodigoServico(settings.codigoServicoPadrao || '0107')
        setAliquota(String(settings.aliquotaPadrao ?? 2.9))
      })
      .catch(() => toast.error('Erro ao carregar configuracao fiscal'))
      .finally(() => setConfigLoading(false))
  }, [])

  // Search clients
  useEffect(() => {
    if (clienteSearch.length < 2) {
      setClientes([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/clientes?search=${encodeURIComponent(clienteSearch)}&limit=10`)
        .then(r => r.json())
        .then(d => setClientes(d.data ?? []))
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [clienteSearch])

  // Search OS
  useEffect(() => {
    if (osSearch.length < 1) {
      setOsList([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/os?search=${encodeURIComponent(osSearch)}&limit=10`)
        .then(r => r.json())
        .then(d => setOsList(d.data ?? []))
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [osSearch])

  function selectCliente(c: Cliente) {
    setSelectedCliente(c)
    setClienteSearch(c.legal_name)
    setShowClienteDropdown(false)
  }

  function selectOs(os: OS) {
    setSelectedOs(os)
    setOsSearch(`OS #${os.os_number} - ${os.equipment_type}`)
    setShowOsDropdown(false)
  }

  function handleValorChange(value: string) {
    setValorDisplay(value)
    setValorCentavos(parseCurrencyInput(value))
  }

  const aliquotaNum = parseFloat(aliquota.replace(',', '.')) || 0
  const issValor = Math.round(valorCentavos * (aliquotaNum / 100))

  const canSubmit = selectedCliente && descricao.trim() && valorCentavos > 0 && codigoServico.trim()

  async function handleSubmit() {
    if (!canSubmit || !selectedCliente) return

    setSubmitting(true)
    setEmissionError(null)
    setEmissionResult(null)

    try {
      const res = await fetch('/api/fiscal/nfse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: selectedCliente.id,
          service_order_id: selectedOs?.id,
          descricao_servico: descricao,
          valor_servicos: valorCentavos,
          codigo_servico: codigoServico,
          aliquota: aliquotaNum,
          iss_retido: issRetido,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setEmissionError(data.error || 'Erro ao emitir NFS-e')
        toast.error(data.error || 'Erro ao emitir NFS-e')
        return
      }

      setEmissionResult(data.data)
      setShowPreview(false)
      toast.success('NFS-e enviada para processamento!')
    } catch {
      setEmissionError('Erro de conexao com o servidor')
      toast.error('Erro de conexao')
    } finally {
      setSubmitting(false)
    }
  }

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  // Show result after emission
  if (emissionResult) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/fiscal" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">NFS-e Emitida</h1>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            {emissionResult.status === 'AUTHORIZED' ? (
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            ) : emissionResult.status === 'PROCESSING' ? (
              <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            ) : (
              <XCircle className="h-8 w-8 text-red-500" />
            )}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {emissionResult.status === 'AUTHORIZED' && 'NFS-e Autorizada'}
                {emissionResult.status === 'PROCESSING' && 'NFS-e em Processamento'}
                {emissionResult.status === 'REJECTED' && 'NFS-e Rejeitada'}
              </h2>
              <p className="text-sm text-gray-500">
                {emissionResult.status === 'PROCESSING'
                  ? 'A prefeitura esta processando sua NFS-e. Acompanhe na lista de notas fiscais.'
                  : emissionResult.invoice_number
                    ? `Numero: ${emissionResult.invoice_number}`
                    : 'Ref: ' + emissionResult.provider_ref
                }
              </p>
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Valor</span>
              <span className="font-medium">{formatCurrency(emissionResult.total_amount)}</span>
            </div>
            {emissionResult.access_key && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Codigo Verificacao</span>
                <span className="font-mono text-xs">{emissionResult.access_key}</span>
              </div>
            )}
          </div>

          {/* Action links */}
          <div className="mt-6 flex flex-wrap gap-3">
            {emissionResult.danfe_url && (
              <a
                href={emissionResult.danfe_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Eye className="h-4 w-4" /> Ver PDF
              </a>
            )}
            {emissionResult.xml_url && (
              <a
                href={emissionResult.xml_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <FileText className="h-4 w-4" /> Ver XML
              </a>
            )}
            <Link
              href="/fiscal"
              className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Voltar para Fiscal
            </Link>
            <button
              type="button"
              onClick={() => {
                setEmissionResult(null)
                setSelectedCliente(null)
                setClienteSearch('')
                setSelectedOs(null)
                setOsSearch('')
                setDescricao('')
                setValorDisplay('')
                setValorCentavos(0)
                setIssRetido(false)
              }}
              className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Emitir Nova NFS-e
            </button>
          </div>
        </div>
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
          <h1 className="text-2xl font-bold text-gray-900">Emitir NFS-e</h1>
        </div>
        <p className="text-sm text-gray-500 ml-7">
          <Link href="/fiscal" className="text-blue-600 hover:underline">Fiscal</Link> / Emitir NFS-e
        </p>
      </div>

      {/* Environment banner */}
      {config?.environment === 'homologacao' && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div>
            <strong>HOMOLOGACAO</strong> — Esta emissao sera feita em ambiente de testes. Nenhuma nota fiscal real sera gerada.
          </div>
        </div>
      )}

      {!config?.has_api_key && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0" />
          <div>
            API Key do Focus NFe nao configurada.{' '}
            <Link href="/fiscal/config" className="font-medium underline">Configure aqui</Link>.
          </div>
        </div>
      )}

      {/* Error message */}
      {emissionError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {emissionError}
        </div>
      )}

      {/* Main form */}
      <div className="space-y-6">
        {/* Customer search */}
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">Tomador do Servico</h2>

          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar cliente por nome ou documento..."
                value={clienteSearch}
                onChange={e => {
                  setClienteSearch(e.target.value)
                  setSelectedCliente(null)
                  setShowClienteDropdown(true)
                }}
                onFocus={() => setShowClienteDropdown(true)}
                className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Dropdown */}
            {showClienteDropdown && clientes.length > 0 && !selectedCliente && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-y-auto">
                {clientes.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCliente(c)}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 flex justify-between items-center"
                  >
                    <span className="font-medium text-gray-900">{c.legal_name}</span>
                    {c.document_number && (
                      <span className="text-xs text-gray-400">{c.document_number}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected customer details */}
          {selectedCliente && (
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50/50 p-3">
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-gray-500">Nome:</span>{' '}
                  <span className="font-medium">{selectedCliente.legal_name}</span>
                </div>
                <div>
                  <span className="text-gray-500">Documento:</span>{' '}
                  <span className="font-medium">{selectedCliente.document_number || '—'}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-gray-500">Endereco:</span>{' '}
                  <span className="font-medium">
                    {[
                      selectedCliente.address_street,
                      selectedCliente.address_number,
                      selectedCliente.address_neighborhood,
                      selectedCliente.address_city,
                      selectedCliente.address_state,
                    ].filter(Boolean).join(', ') || '—'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* OS link (optional) */}
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">Ordem de Servico (opcional)</h2>

          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar OS por numero..."
                value={osSearch}
                onChange={e => {
                  setOsSearch(e.target.value)
                  setSelectedOs(null)
                  setShowOsDropdown(true)
                }}
                onFocus={() => setShowOsDropdown(true)}
                className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {showOsDropdown && osList.length > 0 && !selectedOs && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-y-auto">
                {osList.map(os => (
                  <button
                    key={os.id}
                    type="button"
                    onClick={() => selectOs(os)}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 flex justify-between items-center"
                  >
                    <span className="font-medium text-gray-900">
                      OS #{os.os_number} - {os.equipment_type}
                    </span>
                    {os.customers && (
                      <span className="text-xs text-gray-400">{os.customers.legal_name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedOs && (
            <div className="mt-3 rounded-md border border-green-200 bg-green-50/50 p-3 text-sm">
              <span className="font-medium">
                OS #{selectedOs.os_number} - {selectedOs.equipment_type}
              </span>
              <button
                type="button"
                onClick={() => { setSelectedOs(null); setOsSearch('') }}
                className="ml-2 text-xs text-red-600 hover:underline"
              >
                remover
              </button>
            </div>
          )}
        </div>

        {/* Service details */}
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">Dados do Servico</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Discriminacao do Servico
              </label>
              <textarea
                required
                rows={4}
                placeholder="Descreva detalhadamente os servicos prestados..."
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Valor (R$)
                </label>
                <input
                  required
                  type="text"
                  placeholder="0,00"
                  value={valorDisplay}
                  onChange={e => handleValorChange(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                {valorCentavos > 0 && (
                  <p className="mt-1 text-xs text-gray-400">
                    {formatCurrency(valorCentavos)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Codigo Servico
                </label>
                <input
                  required
                  type="text"
                  placeholder="0107"
                  value={codigoServico}
                  onChange={e => setCodigoServico(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Item da lista de servicos LC 116/03
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Aliquota ISS (%)
                </label>
                <input
                  required
                  type="text"
                  placeholder="2.9"
                  value={aliquota}
                  onChange={e => setAliquota(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* ISS Retido */}
            <div className="flex items-center gap-3">
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={issRetido}
                  onChange={e => setIssRetido(e.target.checked)}
                  className="peer sr-only"
                  aria-label="ISS Retido pelo Tomador"
                />
                <div className="h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-focus:ring-2 peer-focus:ring-blue-300" />
              </label>
              <span className="text-sm text-gray-700">ISS Retido pelo Tomador</span>
            </div>

            {/* Tax preview */}
            {valorCentavos > 0 && aliquotaNum > 0 && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">ISS ({aliquota}%)</span>
                  <span className="font-medium">{formatCurrency(issValor)}</span>
                </div>
                {issRetido && (
                  <p className="text-xs text-gray-400 mt-1">
                    ISS sera retido pelo tomador do servico
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Preview / Submit */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            <Eye className="h-4 w-4" />
            {showPreview ? 'Ocultar Preview' : 'Preview NFS-e'}
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {submitting ? 'Emitindo...' : 'Emitir NFS-e'}
          </button>
        </div>

        {/* Preview panel */}
        {showPreview && canSubmit && selectedCliente && (
          <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/30 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Preview da NFS-e
            </h3>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium uppercase text-gray-400">Tomador</p>
                  <p className="font-medium">{selectedCliente.legal_name}</p>
                  <p className="text-gray-500">{selectedCliente.document_number}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-gray-400">Servico</p>
                  <p className="font-medium">Codigo: {codigoServico}</p>
                  <p className="text-gray-500">Aliquota: {aliquota}%</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium uppercase text-gray-400">Discriminacao</p>
                <p className="text-gray-700 whitespace-pre-wrap">{descricao}</p>
              </div>

              <div className="border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-gray-500">Valor dos Servicos</span>
                  <span className="font-bold text-lg">{formatCurrency(valorCentavos)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>ISS ({aliquota}%) {issRetido ? '(retido)' : ''}</span>
                  <span>{formatCurrency(issValor)}</span>
                </div>
              </div>

              {selectedOs && (
                <div className="border-t pt-3">
                  <p className="text-xs font-medium uppercase text-gray-400">OS Vinculada</p>
                  <p className="text-gray-700">#{selectedOs.os_number} - {selectedOs.equipment_type}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
