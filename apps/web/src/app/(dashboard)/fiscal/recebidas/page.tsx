'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, RefreshCw, Loader2, FileText, Download,
  CheckCircle2, XCircle, HelpCircle, Eye, Package,
  AlertTriangle, Search, ShoppingCart, ChevronDown, ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'

// ---------- Types ----------

interface NfeRecebida {
  chave: string
  nome_emitente: string
  cnpj_emitente: string
  valor_total: number
  data_emissao: string
  situacao: string
  manifestacao?: string
  tipo_nfe?: string
  numero?: string
  serie?: string
}

interface NfeDetalhe {
  // Raw data from Focus NFe
  [key: string]: any
}

// ---------- Helpers ----------

function formatCurrency(reais: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(reais)
}

function formatCnpj(cnpj: string) {
  if (!cnpj || cnpj.length !== 14) return cnpj
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

function truncateChave(chave: string) {
  if (!chave || chave.length <= 20) return chave
  return `${chave.slice(0, 10)}...${chave.slice(-10)}`
}

const situacaoConfig: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-700' },
  ciencia: { label: 'Ciencia', color: 'bg-blue-100 text-blue-700' },
  confirmada: { label: 'Confirmada', color: 'bg-green-100 text-green-700' },
  desconhecida: { label: 'Desconhecida', color: 'bg-red-100 text-red-700' },
  nao_realizada: { label: 'Nao Realizada', color: 'bg-gray-100 text-gray-700' },
}

const manifestacaoActions = [
  { tipo: 'ciencia', label: 'Ciencia', icon: Eye, color: 'text-blue-600 hover:bg-blue-50', desc: 'Declara ciencia da operacao' },
  { tipo: 'confirmacao', label: 'Confirmar', icon: CheckCircle2, color: 'text-green-600 hover:bg-green-50', desc: 'Confirma a realizacao da operacao' },
  { tipo: 'desconhecimento', label: 'Desconhecer', icon: HelpCircle, color: 'text-orange-600 hover:bg-orange-50', desc: 'Declara desconhecimento da operacao' },
  { tipo: 'nao_realizada', label: 'Nao Realizada', icon: XCircle, color: 'text-red-600 hover:bg-red-50', desc: 'Declara que a operacao nao foi realizada' },
] as const

// ---------- Component ----------

export default function RecebidasPage() {
  const [recebidas, setRecebidas] = useState<NfeRecebida[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Manifestacao state
  const [manifestandoChave, setManifestandoChave] = useState<string | null>(null)
  const [manifestandoTipo, setManifestandoTipo] = useState<string | null>(null)

  // Justificativa modal
  const [showJustificativaModal, setShowJustificativaModal] = useState(false)
  const [justificativaChave, setJustificativaChave] = useState('')
  const [justificativaTipo, setJustificativaTipo] = useState('')
  const [justificativaText, setJustificativaText] = useState('')

  // Detail modal
  const [detailChave, setDetailChave] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<NfeDetalhe | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Import state
  const [importingChave, setImportingChave] = useState<string | null>(null)

  // Expanded rows (for inline detail)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // ---------- Fetch recebidas ----------

  const fetchRecebidas = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/fiscal/recebidas')
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao buscar NF-e recebidas')
        return
      }

      setRecebidas(data.data || [])
      setLoaded(true)
      toast.success(`${(data.data || []).length} NF-e recebida(s) encontrada(s)`)
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setLoading(false)
    }
  }, [])

  // ---------- Manifestar ----------

  async function handleManifestar(chave: string, tipo: string, justificativa?: string) {
    // Se precisa de justificativa e nao tem, abrir modal
    if ((tipo === 'desconhecimento' || tipo === 'nao_realizada') && !justificativa) {
      setJustificativaChave(chave)
      setJustificativaTipo(tipo)
      setJustificativaText('')
      setShowJustificativaModal(true)
      return
    }

    setManifestandoChave(chave)
    setManifestandoTipo(tipo)

    try {
      const res = await fetch('/api/fiscal/recebidas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave, tipo, justificativa }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao manifestar')
        return
      }

      toast.success(data.data?.message || 'Manifestacao registrada')

      // Update local state
      setRecebidas(prev => prev.map(nfe =>
        nfe.chave === chave ? { ...nfe, situacao: tipo === 'confirmacao' ? 'confirmada' : tipo, manifestacao: tipo } : nfe
      ))
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setManifestandoChave(null)
      setManifestandoTipo(null)
    }
  }

  async function handleJustificativaSubmit() {
    if (justificativaText.trim().length < 15) {
      toast.error('Justificativa deve ter no minimo 15 caracteres')
      return
    }
    setShowJustificativaModal(false)
    await handleManifestar(justificativaChave, justificativaTipo, justificativaText)
  }

  // ---------- Detail ----------

  async function fetchDetail(chave: string) {
    if (expandedRows.has(chave)) {
      setExpandedRows(prev => {
        const next = new Set(prev)
        next.delete(chave)
        return next
      })
      return
    }

    setDetailLoading(true)
    setExpandedRows(prev => new Set(prev).add(chave))

    try {
      const res = await fetch(`/api/fiscal/recebidas/${encodeURIComponent(chave)}`)
      const data = await res.json()

      if (res.ok) {
        setDetailChave(chave)
        setDetailData(data.data)
      } else {
        toast.error(data.error || 'Erro ao obter detalhes')
      }
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setDetailLoading(false)
    }
  }

  // ---------- Import ----------

  async function handleImport(chave: string) {
    setImportingChave(chave)

    try {
      const res = await fetch(`/api/fiscal/recebidas/${encodeURIComponent(chave)}`, {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao importar')
        return
      }

      toast.success('NF-e importada para compras com sucesso!')
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setImportingChave(null)
    }
  }

  // ---------- Filter ----------

  const filteredRecebidas = searchTerm
    ? recebidas.filter(nfe =>
      nfe.nome_emitente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      nfe.cnpj_emitente.includes(searchTerm.replace(/\D/g, '')) ||
      nfe.chave.includes(searchTerm.replace(/\D/g, ''))
    )
    : recebidas

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/fiscal" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">NF-e Recebidas (MDe)</h1>
          </div>
          <p className="text-sm text-gray-500 ml-7">
            Manifesto do Destinatario - NF-e emitidas contra seu CNPJ
          </p>
        </div>

        <button
          type="button"
          onClick={fetchRecebidas}
          disabled={loading}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Buscar Novas NF-e
        </button>
      </div>

      {/* Info banner */}
      {!loaded && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Manifesto do Destinatario Eletronico (MDe)</p>
            <p className="mt-1">
              Clique em &quot;Buscar Novas NF-e&quot; para consultar notas fiscais emitidas contra seu CNPJ na SEFAZ.
              Apos a busca, voce pode manifestar (ciencia, confirmacao, desconhecimento, nao realizada) e importar para compras.
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      {loaded && recebidas.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por emitente, CNPJ ou chave..."
              aria-label="Buscar NF-e recebidas"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <span className="text-sm text-gray-400">
            {filteredRecebidas.length} de {recebidas.length} nota{recebidas.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Table */}
      {loaded && (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Emitente</th>
                <th className="px-4 py-3">Chave</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Situacao</th>
                <th className="px-4 py-3">Manifestacao</th>
                <th className="px-4 py-3 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
                    <p className="mt-2 text-sm text-gray-400">Consultando SEFAZ...</p>
                  </td>
                </tr>
              ) : filteredRecebidas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <FileText className="mx-auto h-8 w-8 text-gray-300" />
                    <p className="mt-2 text-sm text-gray-400">
                      {recebidas.length === 0
                        ? 'Nenhuma NF-e recebida encontrada'
                        : 'Nenhum resultado para o filtro aplicado'
                      }
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRecebidas.map(nfe => (
                  <>
                    <tr key={nfe.chave} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{nfe.nome_emitente || '---'}</p>
                        <p className="text-xs text-gray-400">{formatCnpj(nfe.cnpj_emitente)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          title="Ver detalhes da NF-e"
                          onClick={() => fetchDetail(nfe.chave)}
                          className="font-mono text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          {truncateChave(nfe.chave)}
                          {expandedRows.has(nfe.chave) ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                        {nfe.numero && (
                          <p className="text-xs text-gray-400">N: {nfe.numero} S: {nfe.serie}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {formatCurrency(nfe.valor_total)}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {nfe.data_emissao
                          ? new Date(nfe.data_emissao).toLocaleDateString('pt-BR')
                          : '---'
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                          situacaoConfig[nfe.situacao]?.color ?? 'bg-gray-100 text-gray-700'
                        )}>
                          {situacaoConfig[nfe.situacao]?.label ?? nfe.situacao}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {manifestacaoActions.map(action => {
                            const Icon = action.icon
                            const isActive = manifestandoChave === nfe.chave && manifestandoTipo === action.tipo
                            return (
                              <button
                                key={action.tipo}
                                type="button"
                                title={action.desc}
                                onClick={() => handleManifestar(nfe.chave, action.tipo)}
                                disabled={manifestandoChave === nfe.chave}
                                className={cn(
                                  'rounded p-1.5 transition-colors',
                                  action.color,
                                  manifestandoChave === nfe.chave && 'opacity-50'
                                )}
                              >
                                {isActive ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Icon className="h-4 w-4" />
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Importar para compras"
                            onClick={() => handleImport(nfe.chave)}
                            disabled={importingChave === nfe.chave}
                            className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50 disabled:opacity-50"
                          >
                            {importingChave === nfe.chave ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ShoppingCart className="h-3.5 w-3.5" />
                            )}
                            Importar
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expandedRows.has(nfe.chave) && (
                      <tr key={`${nfe.chave}-detail`}>
                        <td colSpan={7} className="bg-gray-50 px-4 py-4">
                          {detailLoading && detailChave !== nfe.chave ? (
                            <div className="flex items-center gap-2 text-sm text-gray-400">
                              <Loader2 className="h-4 w-4 animate-spin" /> Carregando detalhes...
                            </div>
                          ) : detailData && detailChave === nfe.chave ? (
                            <div className="space-y-4">
                              {/* Chave completa */}
                              <div>
                                <p className="text-xs font-medium uppercase text-gray-400 mb-1">Chave NF-e</p>
                                <p className="font-mono text-xs text-gray-700 break-all">{nfe.chave}</p>
                              </div>

                              {/* Emitente info */}
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
                                <div>
                                  <p className="text-xs text-gray-400">Emitente</p>
                                  <p className="font-medium">{detailData.nome_emitente || detailData.razao_social_emitente || nfe.nome_emitente}</p>
                                  <p className="text-xs text-gray-500">{formatCnpj(detailData.cnpj_emitente || nfe.cnpj_emitente)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-400">Valor Total</p>
                                  <p className="font-medium">{formatCurrency(detailData.valor_total || nfe.valor_total)}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-400">Natureza Operacao</p>
                                  <p className="font-medium">{detailData.natureza_operacao || '---'}</p>
                                </div>
                              </div>

                              {/* Items */}
                              {(detailData.items || detailData.itens || []).length > 0 && (
                                <div>
                                  <p className="text-xs font-medium uppercase text-gray-400 mb-2">Itens</p>
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b text-left text-gray-400">
                                        <th className="pb-1 pr-2">#</th>
                                        <th className="pb-1 pr-2">Descricao</th>
                                        <th className="pb-1 pr-2 text-right">Qtd</th>
                                        <th className="pb-1 pr-2 text-right">V.Unit.</th>
                                        <th className="pb-1 text-right">V.Total</th>
                                        <th className="pb-1 text-right">NCM</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(detailData.items || detailData.itens || []).map((item: any, idx: number) => (
                                        <tr key={idx} className="border-b border-dashed">
                                          <td className="py-1 pr-2">{item.numero_item || idx + 1}</td>
                                          <td className="py-1 pr-2 font-medium">{item.descricao || item.nome || '---'}</td>
                                          <td className="py-1 pr-2 text-right">{item.quantidade_comercial || item.quantidade || 1}</td>
                                          <td className="py-1 pr-2 text-right">
                                            {formatCurrency(parseFloat(item.valor_unitario_comercial || item.valor_unitario || '0'))}
                                          </td>
                                          <td className="py-1 text-right font-medium">
                                            {formatCurrency(parseFloat(item.valor_bruto || item.valor_total || '0'))}
                                          </td>
                                          <td className="py-1 text-right text-gray-400">{item.codigo_ncm || item.ncm || '---'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Totais */}
                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm rounded-md bg-gray-100 p-3">
                                <div>
                                  <p className="text-xs text-gray-400">Produtos</p>
                                  <p className="font-medium">{formatCurrency(parseFloat(detailData.valor_produtos || '0'))}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-400">Frete</p>
                                  <p className="font-medium">{formatCurrency(parseFloat(detailData.valor_frete || '0'))}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-400">Desconto</p>
                                  <p className="font-medium">{formatCurrency(parseFloat(detailData.valor_desconto || '0'))}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-400">Total NF-e</p>
                                  <p className="font-bold">{formatCurrency(parseFloat(detailData.valor_total || String(nfe.valor_total)))}</p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-gray-400">
                              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Justificativa Modal */}
      {showJustificativaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {justificativaTipo === 'desconhecimento' ? 'Desconhecimento da Operacao' : 'Operacao Nao Realizada'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Chave: {truncateChave(justificativaChave)}
            </p>

            <div className="mb-4">
              <label htmlFor="justificativa-input" className="block text-sm font-medium text-gray-700 mb-1">
                Justificativa
              </label>
              <textarea
                id="justificativa-input"
                rows={3}
                placeholder="Informe o motivo (minimo 15 caracteres)..."
                value={justificativaText}
                onChange={e => setJustificativaText(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                {justificativaText.length}/15 caracteres minimos
              </p>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowJustificativaModal(false)}
                className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleJustificativaSubmit}
                disabled={justificativaText.trim().length < 15}
                className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
