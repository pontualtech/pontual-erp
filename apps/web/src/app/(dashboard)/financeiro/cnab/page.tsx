'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Upload, Loader2, CheckCircle, XCircle, FileText, Settings, Save, AlertTriangle, Printer, Mail } from 'lucide-react'
import { toast } from 'sonner'

interface RetornoResult {
  success: boolean
  total: number
  pagos: number
  rejeitados: number
  outros: number
  totalRecebido: number
  contaBancaria: string | null
  detalhes: Array<{ nossoNumero: string; seuNumero: string; status: string; valorPago: number; ocorrencia: string }>
}

export default function CNABPage() {
  const [tab, setTab] = useState<'remessa' | 'retorno' | 'config'>('remessa')

  // Remessa
  const [generating, setGenerating] = useState(false)
  const [lastRemessaIds, setLastRemessaIds] = useState<string[]>([])
  const [sendingEmails, setSendingEmails] = useState(false)

  // Retorno
  const [processing, setProcessing] = useState(false)
  const [retornoResult, setRetornoResult] = useState<RetornoResult | null>(null)

  // Config
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cnpj, setCnpj] = useState('')
  const [razaoSocial, setRazaoSocial] = useState('')
  const [agencia, setAgencia] = useState('')
  const [conta, setConta] = useState('')
  const [convenio, setConvenio] = useState('')
  const [carteira, setCarteira] = useState('112')
  const [interClientId, setInterClientId] = useState('')
  const [interClientSecret, setInterClientSecret] = useState('')

  useEffect(() => {
    fetch('/api/settings/cnab-config')
      .then(r => r.json())
      .then(d => {
        if (d.cnpj) setCnpj(d.cnpj)
        if (d.razao_social) setRazaoSocial(d.razao_social)
        if (d.agencia) setAgencia(d.agencia)
        if (d.conta) setConta(d.conta)
        if (d.convenio) setConvenio(d.convenio)
        if (d.carteira) setCarteira(d.carteira)
        if (d.inter_client_id) setInterClientId(d.inter_client_id)
        if (d.inter_client_secret) setInterClientSecret(d.inter_client_secret)
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleGerarRemessa() {
    setGenerating(true)
    try {
      const res = await fetch('/api/financeiro/cnab?all_pending=true')
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Erro ao gerar remessa')
        return
      }

      // Capturar IDs dos boletos gerados (header customizado)
      const ids = res.headers.get('X-Boleto-Ids')
      if (ids) setLastRemessaIds(ids.split(','))

      // Download do arquivo
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'remessa.rem'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Arquivo de remessa gerado com sucesso!')
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar remessa')
    } finally {
      setGenerating(false)
    }
  }

  function handlePrintAll() {
    if (lastRemessaIds.length > 0) {
      window.open(`/boleto-print?ids=${lastRemessaIds.join(',')}`, '_blank')
    }
  }

  async function handleEmailAll() {
    if (lastRemessaIds.length === 0) return
    setSendingEmails(true)
    try {
      const res = await fetch('/api/financeiro/boletos/enviar-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: lastRemessaIds }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar emails')
      toast.success(`${data.enviados} email(s) enviado(s)${data.erros > 0 ? `, ${data.erros} erro(s)` : ''}`)
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar emails')
    } finally {
      setSendingEmails(false)
    }
  }

  async function handleImportarRetorno(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setProcessing(true)
    setRetornoResult(null)
    try {
      const content = await file.text()
      const res = await fetch('/api/financeiro/cnab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (res.ok) {
        setRetornoResult(data)
        toast.success(`Retorno processado: ${data.pagos} pagos, ${data.rejeitados} rejeitados`)
      } else {
        toast.error(data.error || 'Erro ao processar retorno')
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao processar retorno')
    } finally {
      setProcessing(false)
      e.target.value = ''
    }
  }

  async function handleSaveConfig() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/cnab-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, razao_social: razaoSocial, agencia, conta, convenio, carteira, inter_client_id: interClientId, inter_client_secret: interClientSecret }),
      })
      if (res.ok) toast.success('Configuracao salva!')
      else toast.error('Erro ao salvar')
    } catch { toast.error('Erro ao salvar') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/financeiro" className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5 text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Boletos CNAB — Banco Inter</h1>
          <p className="text-sm text-gray-500">Gerar remessa e importar retorno (CNAB 400)</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {(['remessa', 'retorno', 'config'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            {t === 'remessa' ? 'Gerar Remessa' : t === 'retorno' ? 'Importar Retorno' : 'Configuracao'}
          </button>
        ))}
      </div>

      {/* TAB: Remessa */}
      {tab === 'remessa' && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-blue-50 p-4">
            <h3 className="font-medium text-blue-900">Como funciona</h3>
            <ul className="mt-2 space-y-1 text-sm text-blue-800">
              <li>1. Clique em "Gerar Arquivo de Remessa"</li>
              <li>2. O sistema gera um arquivo .rem com todas as contas a receber pendentes</li>
              <li>3. Faca upload do arquivo no Internet Banking do Banco Inter</li>
              <li>4. O banco registra os boletos e disponibiliza para pagamento</li>
            </ul>
          </div>

          <div className="rounded-lg border bg-white p-6 shadow-sm text-center">
            <FileText className="h-12 w-12 text-orange-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Arquivo de Remessa CNAB 400</h3>
            <p className="text-sm text-gray-500 mb-6">
              Gera arquivo com todas as contas a receber pendentes que ainda nao tem boleto registrado
            </p>
            <button onClick={handleGerarRemessa} disabled={generating}
              className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-6 py-3 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {generating ? 'Gerando...' : 'Gerar Arquivo de Remessa'}
            </button>
          </div>

          {/* Acoes pos-remessa */}
          {lastRemessaIds.length > 0 && (
            <div className="rounded-lg border bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Remessa gerada — {lastRemessaIds.length} boleto(s)
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Agora voce pode imprimir os boletos ou enviar por email para os clientes:
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={handlePrintAll}
                  className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-900">
                  <Printer className="h-4 w-4" /> Imprimir Todos
                </button>
                <button type="button" onClick={handleEmailAll} disabled={sendingEmails}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {sendingEmails ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {sendingEmails ? 'Enviando...' : 'Enviar Todos por Email'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: Retorno */}
      {tab === 'retorno' && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-green-50 p-4">
            <h3 className="font-medium text-green-900">Como funciona</h3>
            <ul className="mt-2 space-y-1 text-sm text-green-800">
              <li>1. Baixe o arquivo de retorno (.ret) no Internet Banking do Banco Inter</li>
              <li>2. Importe o arquivo abaixo</li>
              <li>3. O sistema atualiza as contas, gera os lancamentos financeiros e atualiza o saldo bancario</li>
            </ul>
          </div>

          <div className="rounded-lg border bg-white p-6 shadow-sm text-center">
            <Upload className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Importar Arquivo de Retorno</h3>
            <p className="text-sm text-gray-500 mb-6">
              Selecione o arquivo .ret baixado do Internet Banking
            </p>
            <label className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-sm font-medium text-white hover:bg-green-700 cursor-pointer disabled:opacity-50">
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {processing ? 'Processando...' : 'Selecionar Arquivo .ret'}
              <input type="file" accept=".ret,.RET,.txt,.TXT" onChange={handleImportarRetorno} className="hidden" disabled={processing} />
            </label>
          </div>

          {/* Resultado do retorno */}
          {retornoResult && (
            <div className="rounded-lg border bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-2">Resultado do Processamento</h3>

              {/* Total recebido destaque */}
              {retornoResult.totalRecebido > 0 && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 mb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-emerald-700 font-medium">Total recebido</p>
                      <p className="text-3xl font-bold text-emerald-700">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(retornoResult.totalRecebido / 100)}
                      </p>
                    </div>
                    <div className="text-right text-sm text-emerald-600">
                      <p>{retornoResult.pagos} boleto(s) pago(s)</p>
                      {retornoResult.contaBancaria && <p>Lancamento gerado na conta bancaria</p>}
                      {!retornoResult.contaBancaria && <p className="text-amber-600">Sem conta bancaria vinculada — cadastre em Contas</p>}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="rounded-lg bg-green-50 p-3 text-center">
                  <CheckCircle className="h-6 w-6 text-green-600 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-green-700">{retornoResult.pagos}</p>
                  <p className="text-xs text-green-600">Pagos</p>
                </div>
                <div className="rounded-lg bg-red-50 p-3 text-center">
                  <XCircle className="h-6 w-6 text-red-600 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-red-700">{retornoResult.rejeitados}</p>
                  <p className="text-xs text-red-600">Rejeitados</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <AlertTriangle className="h-6 w-6 text-gray-500 mx-auto mb-1" />
                  <p className="text-2xl font-bold text-gray-700">{retornoResult.outros}</p>
                  <p className="text-xs text-gray-500">Outros</p>
                </div>
              </div>

              {retornoResult.detalhes.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900">
                    Ver detalhes ({retornoResult.detalhes.length} registros)
                  </summary>
                  <div className="mt-2 max-h-60 overflow-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-gray-500 border-b"><th className="py-1 text-left">Nosso Num</th><th className="text-left">Status</th><th className="text-right">Valor</th><th className="text-left">Ocorrencia</th></tr></thead>
                      <tbody>
                        {retornoResult.detalhes.map((d, i) => (
                          <tr key={i} className="border-b"><td className="py-1 font-mono">{d.nossoNumero}</td>
                            <td><span className={`px-1.5 py-0.5 rounded text-xs ${d.status === 'PAGO' ? 'bg-green-100 text-green-700' : d.status === 'REJEITADO' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{d.status}</span></td>
                            <td className="text-right">R$ {(d.valorPago / 100).toFixed(2)}</td>
                            <td>{d.ocorrencia}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB: Config */}
      {tab === 'config' && (
        <div className="rounded-lg border bg-white shadow-sm">
          <div className="border-b px-6 py-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Settings className="h-5 w-5 text-orange-600" />
              Dados Bancarios — Banco Inter
            </h2>
            <p className="text-sm text-gray-500 mt-1">Configuracao do cedente para geracao de boletos CNAB 400</p>
          </div>
          <div className="p-6 space-y-4">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
                    <input value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="00.000.000/0001-00"
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Razao Social</label>
                    <input value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Agencia (com digito)</label>
                    <input value={agencia} onChange={e => setAgencia(e.target.value)} placeholder="0001-9"
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Conta Corrente (com digito)</label>
                    <input value={conta} onChange={e => setConta(e.target.value)} placeholder="12345678-9"
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Codigo do Convenio</label>
                    <input value={convenio} onChange={e => setConvenio(e.target.value)} placeholder="Codigo beneficiario Inter"
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Carteira</label>
                    <input value={carteira} onChange={e => setCarteira(e.target.value)} placeholder="112"
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
                    <p className="mt-1 text-xs text-gray-400">112 = Cobranca registrada Inter</p>
                  </div>
                </div>

                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">API Banco Inter (para emissao online de boletos)</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
                      <input value={interClientId} onChange={e => setInterClientId(e.target.value)} placeholder="Client ID da API Inter"
                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
                      <input type="password" value={interClientSecret} onChange={e => setInterClientSecret(e.target.value)} placeholder="Client Secret da API Inter"
                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-500" />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">Obtido no painel de desenvolvedores do Banco Inter. Usa o mesmo certificado A1 do modulo fiscal (mTLS).</p>
                </div>
                <div className="flex justify-end pt-2">
                  <button onClick={handleSaveConfig} disabled={saving}
                    className="flex items-center gap-2 rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
