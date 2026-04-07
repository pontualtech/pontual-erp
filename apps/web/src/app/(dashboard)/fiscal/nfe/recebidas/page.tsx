'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, RefreshCw, Loader2, FileText, Download, Upload,
  CheckCircle2, XCircle, AlertTriangle, Search, ShoppingCart,
  ChevronDown, ChevronUp, Copy, Package, Home, Eye,
  HelpCircle, ChevronLeft, ChevronRight, Info, Code, X,
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
  items_data: any
  created_at: string
  updated_at: string
}

interface ImportResult {
  imported: number
  errors: string[]
}

interface SyncResult {
  cStat: string
  motivo: string
  documentos_importados: number
  ultimo_nsu: string
  tem_mais: boolean
  ambiente: string
  cnpj: string
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

function DetailPanel({ nfe, onClose, onShowXml }: { nfe: NfeRecebida; onClose: () => void; onShowXml: (nfe: NfeRecebida) => void }) {
  const xmlData = nfe.xml_data || {}
  const itemsFromXml = xmlData.items || xmlData.itens || []
  const itemsFromData = Array.isArray(nfe.items_data) ? nfe.items_data : []
  const items = itemsFromData.length > 0 ? itemsFromData : itemsFromXml

  return (
    <div className="border-t bg-gray-50 px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-gray-700">Detalhes da NF-e</h4>
        <div className="flex items-center gap-2">
          {nfe.xml_data?.xml && (
            <button type="button" onClick={() => onShowXml(nfe)}
              className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-white hover:text-blue-600 transition-colors">
              <Code className="h-3.5 w-3.5" /> Ver XML
            </button>
          )}
          <button type="button" onClick={onClose} title="Fechar detalhes" className="text-gray-400 hover:text-gray-600">
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
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

      {/* Items */}
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
                  <th className="px-3 py-2">CFOP</th>
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
                    <td className="px-3 py-2 text-gray-400">{item.cfop || '---'}</td>
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
          Detalhes dos itens nao disponiveis. Importe o XML ou faca a manifestacao de "Ciencia" para obter o XML completo.
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
  const [uploadingXml, setUploadingXml] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [xmlViewNfe, setXmlViewNfe] = useState<NfeRecebida | null>(null)

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

  // ---------- Import XML ----------

  async function handleImportXml(files: FileList | null) {
    if (!files || files.length === 0) return

    setUploadingXml(true)
    setImportResult(null)

    try {
      const formData = new FormData()
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i])
      }

      const res = await fetch('/api/fiscal/nfe-recebidas/import-xml', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao importar XML')
        return
      }

      const result = data.data as ImportResult
      setImportResult(result)

      if (result.imported > 0) {
        toast.success(`${result.imported} NF-e importada(s) com sucesso!`)
        loadRecebidas()
      }
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} erro(s) na importacao`)
      }
    } catch {
      toast.error('Erro ao enviar arquivos XML')
    } finally {
      setUploadingXml(false)
    }
  }

  // ---------- Show XML ----------

  function handleShowXml(nfe: NfeRecebida) {
    setXmlViewNfe(nfe)
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

        <div className="flex items-center gap-2">
          <label
            className={cn(
              'flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700 hover:bg-green-100 shadow-sm cursor-pointer transition-colors',
              uploadingXml && 'opacity-50 pointer-events-none'
            )}
          >
            {uploadingXml ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Importar XML
            <input
              type="file"
              accept=".xml"
              multiple
              className="hidden"
              onChange={e => handleImportXml(e.target.files)}
              disabled={uploadingXml}
            />
          </label>

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
      </div>

      {/* Sync Result Banner */}
      {syncResult && (
        <div className={cn(
          'rounded-xl border px-4 py-3 text-sm flex items-start gap-3',
          syncResult.cStat === '656' ? 'border-amber-200 bg-amber-50 text-amber-800'
            : syncResult.documentos_importados > 0 ? 'border-green-200 bg-green-50 text-green-800'
            : syncResult.cStat === '137' ? 'border-blue-200 bg-blue-50 text-blue-800'
            : 'border-gray-200 bg-gray-50 text-gray-800'
        )}>
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">
              {syncResult.cStat === '656' ? 'Limite de consultas atingido — aguarde 1 hora para tentar novamente'
                : syncResult.cStat === '137' ? 'Nenhum documento novo encontrado na SEFAZ'
                : syncResult.cStat === '138' ? `${syncResult.documentos_importados} documento(s) importado(s) — tem mais disponivel`
                : `Sincronizacao: ${syncResult.documentos_importados} documento(s) — Status ${syncResult.cStat}`}
            </p>
            <p className="text-xs mt-0.5 opacity-75">
              NSU: {syncResult.ultimo_nsu} | cStat: {syncResult.cStat} {syncResult.motivo ? `— ${syncResult.motivo}` : ''}
              <br />CNPJ: {syncResult.cnpj} | Ambiente: {syncResult.ambiente}
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

      {/* Import XML Result Banner */}
      {importResult && (
        <div className={cn(
          'rounded-xl border px-4 py-3 text-sm flex items-start gap-3',
          importResult.errors.length > 0 && importResult.imported === 0
            ? 'border-red-200 bg-red-50 text-red-800'
            : importResult.errors.length > 0
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-green-200 bg-green-50 text-green-800'
        )}>
          {importResult.imported > 0 ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-medium">
              {importResult.imported > 0
                ? `${importResult.imported} NF-e importada(s) com sucesso via XML`
                : 'Nenhuma NF-e importada'}
              {importResult.errors.length > 0 && ` | ${importResult.errors.length} erro(s)`}
            </p>
            {importResult.errors.length > 0 && (
              <ul className="mt-1 text-xs opacity-75 list-disc list-inside">
                {importResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" onClick={() => setImportResult(null)} title="Fechar"
            className="text-current opacity-50 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Info banner (before first load) */}
      {!loading && recebidas.length === 0 && !syncResult && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Manifesto do Destinatario Eletronico (MDe)</p>
            <p className="mt-1">
              Clique em &quot;Sincronizar com SEFAZ&quot; para consultar notas fiscais emitidas contra seu CNPJ,
              ou use &quot;Importar XML&quot; para carregar arquivos XML de NF-e recebidas manualmente.
              Apos a importacao, voce pode visualizar detalhes, ver itens, copiar dados para nova NF-e ou importar no estoque.
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
                        <DetailPanel nfe={nfe} onClose={() => toggleExpand(nfe.id)} onShowXml={handleShowXml} />
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

      {/* XML Viewer Modal */}
      {xmlViewNfe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-4xl max-h-[80vh] rounded-lg bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">XML da NF-e</h3>
                <p className="text-sm text-gray-500">
                  Chave: {xmlViewNfe.chave_nfe}
                </p>
              </div>
              <button type="button" onClick={() => setXmlViewNfe(null)} title="Fechar"
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <pre className="whitespace-pre-wrap break-all text-xs font-mono text-gray-700 bg-gray-50 rounded-lg p-4 border">
                {xmlViewNfe.xml_data?.xml || 'XML nao disponivel'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
