'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, RefreshCw, Loader2, FileText, Download,
  CheckCircle2, XCircle, AlertTriangle, Search, ShoppingCart,
  ChevronDown, ChevronUp, Copy, Package, Home, Eye,
  HelpCircle, ChevronLeft, ChevronRight, Info,
} from 'lucide-react'
import { toast } from 'sonner'

// ---------- Types ----------

interface NfeRecebida {
  id: string
  chave_nfe: string
  numero: number | null
  serie: string | null
  cnpj_emitente: string
  nome_emitente: string
  valor_total: number // centavos
  data_emissao: string | null
  situacao: string
  manifestacao: string | null
  importada: boolean
  xml_data: any
  created_at: string
  updated_at: string
}

interface SyncResult {
  cStat: string
  documentos_importados: number
  ultimo_nsu: string
  tem_mais: boolean
}

// ---------- Helpers ----------

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatCnpj(cnpj: string) {
  if (!cnpj || cnpj.length !== 14) return cnpj
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

function truncateChave(chave: string) {
  if (!chave || chave.length <= 24) return chave
  return `${chave.slice(0, 12)}...${chave.slice(-12)}`
}

const situacaoConfig: Record<string, { label: string; color: string }> = {
  autorizada: { label: 'Autorizada', color: 'bg-green-100 text-green-700' },
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-700' },
  cancelada: { label: 'Cancelada', color: 'bg-red-100 text-red-700' },
  denegada: { label: 'Denegada', color: 'bg-gray-100 text-gray-600' },
}

const manifestacaoConfig: Record<string, { label: string; color: string }> = {
  ciencia: { label: 'Ciencia', color: 'bg-blue-100 text-blue-700' },
  confirmada: { label: 'Confirmada', color: 'bg-green-100 text-green-700' },
  desconhecida: { label: 'Desconhecida', color: 'bg-red-100 text-red-700' },
  nao_realizada: { label: 'Nao Realizada', color: 'bg-gray-100 text-gray-600' },
}

// ---------- Detail Panel ----------

function DetailPanel({ nfe, onClose }: { nfe: NfeRecebida; onClose: () => void }) {
  const xmlData = nfe.xml_data || {}
  const items = xmlData.items || xmlData.itens || []

  return (
    <div className="border-t bg-gray-50 px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-gray-700">Detalhes da NF-e</h4>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>

      {/* Key */}
      <div className="mb-4">
        <p className="text-xs font-medium uppercase text-gray-400 mb-1">Chave NF-e</p>
        <p className="font-mono text-xs text-gray-700 break-all select-all">{nfe.chave_nfe}</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm mb-4">
        <div>
          <p className="text-xs text-gray-400">Emitente</p>
          <p className="font-medium">{nfe.nome_emitente || '---'}</p>
          <p className="text-xs text-gray-500">{formatCnpj(nfe.cnpj_emitente)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Numero / Serie</p>
          <p className="font-medium">{nfe.numero || '---'} / {nfe.serie || '1'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Data Emissao</p>
          <p className="font-medium">
            {nfe.data_emissao ? new Date(nfe.data_emissao).toLocaleDateString('pt-BR') : '---'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Valor Total</p>
          <p className="font-bold text-green-700">{formatCurrency(nfe.valor_total)}</p>
        </div>
      </div>

      {/* Items from xml_data */}
      {items.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase text-gray-400 mb-2">Itens ({items.length})</p>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-400">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Descricao</th>
                  <th className="px-3 py-2 text-right">Qtd</th>
                  <th className="px-3 py-2 text-right">V. Unit.</th>
                  <th className="px-3 py-2 text-right">V. Total</th>
                  <th className="px-3 py-2">NCM</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{item.numero_item || idx + 1}</td>
                    <td className="px-3 py-2 font-medium">{item.descricao || item.nome || '---'}</td>
                    <td className="px-3 py-2 text-right">
                      {item.quantidade_comercial || item.quantidade || 1}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatCurrency(Math.round(parseFloat(item.valor_unitario_comercial || item.valor_unitario || '0') * 100))}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatCurrency(Math.round(parseFloat(item.valor_bruto || item.valor_total || '0') * 100))}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{item.codigo_ncm || item.ncm || '---'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-lg border border-dashed bg-white px-4 py-6 text-center text-sm text-gray-400">
          <Info className="mx-auto h-5 w-5 mb-1" />
          Detalhes dos itens nao disponiveis. Faca a manifestacao de "Ciencia" para obter o XML completo.
        </div>
      )}
    </div>
  )
}

// ---------- Main Component ----------

export default function NfeRecebidasPage() {
  const router = useRouter()

  const [recebidas, setRecebidas] = useState<NfeRecebida[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [importingId, setImportingId] = useState<string | null>(null)

  // ---------- Load Recebidas ----------

  const loadRecebidas = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '20')

    fetch(`/api/fiscal/nfe-recebidas?${params}`)
      .then(r => r.json())
      .then(d => {
        const result = d.data ?? d
        setRecebidas(result.data ?? [])
        setTotal(result.total ?? 0)
        setTotalPages(result.totalPages ?? 1)
      })
      .catch(() => toast.error('Erro ao carregar NF-e recebidas'))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => {
    loadRecebidas()
  }, [loadRecebidas])

  // ---------- Sync with SEFAZ ----------

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/fiscal/nfe-recebidas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao sincronizar com SEFAZ')
        return
      }

      const result = data.data as SyncResult
      setSyncResult(result)
      toast.success(`${result.documentos_importados} documento(s) sincronizado(s)`)
      loadRecebidas()
    } catch {
      toast.error('Erro de conexao com a SEFAZ')
    } finally {
      setSyncing(false)
    }
  }

  // Continue syncing if "tem mais"
  async function handleSyncMore() {
    handleSync()
  }

  // ---------- Copy to new NF-e ----------

  function handleCopy(nfe: NfeRecebida) {
    // Store NFe data in sessionStorage to pre-fill the emission form
    const copyData = {
      nome_emitente: nfe.nome_emitente,
      cnpj_emitente: nfe.cnpj_emitente,
      chave_nfe: nfe.chave_nfe,
      items: nfe.xml_data?.items || nfe.xml_data?.itens || [],
      valor_total: nfe.valor_total,
    }
    sessionStorage.setItem('nfe_copy_data', JSON.stringify(copyData))
    router.push('/fiscal/nfe/emitir')
    toast.info('Dados da NF-e copiados para o formulario de emissao')
  }

  // ---------- Import to stock ----------

  async function handleImport(nfe: NfeRecebida) {
    setImportingId(nfe.id)
    try {
      const res = await fetch(`/api/fiscal/recebidas/${encodeURIComponent(nfe.chave_nfe)}`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao importar no estoque')
        return
      }

      toast.success('NF-e importada para o estoque/compras com sucesso!')
      loadRecebidas()
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setImportingId(null)
    }
  }

  // ---------- Toggle expand ----------

  function toggleExpand(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---------- Filter ----------

  const filteredRecebidas = searchTerm
    ? recebidas.filter(nfe =>
        nfe.nome_emitente.toLowerCase().includes(searchTerm.toLowerCase()) ||
        nfe.cnpj_emitente.includes(searchTerm.replace(/\D/g, '')) ||
        nfe.chave_nfe.includes(searchTerm.replace(/\D/g, '')) ||
        (nfe.numero && String(nfe.numero).includes(searchTerm))
      )
    : recebidas

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/" className="hover:text-gray-600 flex items-center gap-1">
          <Home className="h-3.5 w-3.5" /> Inicio
        </Link>
        <span>/</span>
        <Link href="/fiscal" className="hover:text-gray-600">Fiscal</Link>
        <span>/</span>
        <Link href="/fiscal/nfe" className="hover:text-gray-600">NF-e</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Recebidas</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/fiscal/nfe" className="rounded-lg border p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">NF-e Recebidas</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Manifesto do Destinatario Eletronico (MDe) - NF-e emitidas contra seu CNPJ
            </p>
          </div>
        </div>

        <button type="button" onClick={handleSync} disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm">
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Sincronizar com SEFAZ
        </button>
      </div>

      {/* Sync Result Banner */}
      {syncResult && (
        <div className={cn(
          'rounded-xl border px-4 py-3 text-sm flex items-start gap-3',
          syncResult.documentos_importados > 0
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-blue-200 bg-blue-50 text-blue-800'
        )}>
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">
              Sincronizacao concluida: {syncResult.documentos_importados} documento(s) importado(s)
            </p>
            <p className="text-xs mt-0.5 opacity-75">
              Ultimo NSU: {syncResult.ultimo_nsu} | Status: {syncResult.cStat}
            </p>
          </div>
          {syncResult.tem_mais && (
            <button type="button" onClick={handleSyncMore} disabled={syncing}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 shrink-0">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Buscar Mais
            </button>
          )}
        </div>
      )}

      {/* Info banner (before first load) */}
      {!loading && recebidas.length === 0 && !syncResult && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Manifesto do Destinatario Eletronico (MDe)</p>
            <p className="mt-1">
              Clique em &quot;Sincronizar com SEFAZ&quot; para consultar notas fiscais emitidas contra seu CNPJ.
              Apos a sincronizacao, voce pode visualizar detalhes, copiar dados para nova NF-e de devolucao ou importar itens no estoque.
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      {recebidas.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input type="text"
              placeholder="Buscar por emitente, CNPJ, numero ou chave..."
              aria-label="Buscar NF-e recebidas"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <span className="text-sm text-gray-400">
            {filteredRecebidas.length} de {total} nota{total !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <th className="px-4 py-3">Numero</th>
              <th className="px-4 py-3">Emitente</th>
              <th className="px-4 py-3">CNPJ</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Situacao</th>
              <th className="px-4 py-3">Importado?</th>
              <th className="px-4 py-3 text-right">Acoes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
                  <p className="mt-2 text-sm text-gray-400">Carregando NF-e recebidas...</p>
                </td>
              </tr>
            ) : filteredRecebidas.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center">
                  <FileText className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm font-medium text-gray-500">
                    {recebidas.length === 0
                      ? 'Nenhuma NF-e recebida encontrada'
                      : 'Nenhum resultado para o filtro aplicado'}
                  </p>
                  {recebidas.length === 0 && (
                    <button type="button" onClick={handleSync} disabled={syncing}
                      className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                      <RefreshCw className="h-4 w-4" /> Sincronizar com SEFAZ
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              filteredRecebidas.map(nfe => (
                <tbody key={nfe.id}>
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => toggleExpand(nfe.id)}
                        className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
                        {nfe.numero || '---'}
                        {nfe.serie && <span className="text-xs text-gray-400">/{nfe.serie}</span>}
                        {expandedRows.has(nfe.id) ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 truncate max-w-[180px]">
                        {nfe.nome_emitente || '---'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <span className="font-mono text-xs">{formatCnpj(nfe.cnpj_emitente)}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatCurrency(nfe.valor_total)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {nfe.data_emissao
                        ? new Date(nfe.data_emissao).toLocaleDateString('pt-BR')
                        : '---'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                        situacaoConfig[nfe.situacao]?.color ?? 'bg-gray-100 text-gray-700'
                      )}>
                        {situacaoConfig[nfe.situacao]?.label ?? nfe.situacao}
                      </span>
                      {nfe.manifestacao && (
                        <span className={cn(
                          'ml-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                          manifestacaoConfig[nfe.manifestacao]?.color ?? 'bg-gray-100 text-gray-600'
                        )}>
                          {manifestacaoConfig[nfe.manifestacao]?.label ?? nfe.manifestacao}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {nfe.importada ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Sim
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Nao</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Expand/details */}
                        <button type="button" onClick={() => toggleExpand(nfe.id)}
                          title="Ver detalhes"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                          <Eye className="h-4 w-4" />
                        </button>

                        {/* Copy to new NF-e */}
                        <button type="button" onClick={() => handleCopy(nfe)}
                          title="Copiar para nova NF-e"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-purple-50 hover:text-purple-600 transition-colors">
                          <Copy className="h-4 w-4" />
                        </button>

                        {/* Import to stock */}
                        <button type="button" onClick={() => handleImport(nfe)}
                          title="Importar no estoque"
                          disabled={importingId === nfe.id || nfe.importada}
                          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-green-600 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                          {importingId === nfe.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Package className="h-3.5 w-3.5" />
                          )}
                          Importar
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail */}
                  {expandedRows.has(nfe.id) && (
                    <tr>
                      <td colSpan={8} className="p-0">
                        <DetailPanel nfe={nfe} onClose={() => toggleExpand(nfe.id)} />
                      </td>
                    </tr>
                  )}
                </tbody>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <span className="text-sm text-gray-500">Pagina {page} de {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
            Proxima <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
