'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Save, Loader2, FileText, CheckCircle, XCircle,
  Upload, Shield, ShieldCheck, ShieldAlert, Lock, Calendar,
  Building2, FileKey, ToggleLeft, ToggleRight, AlertTriangle,
  Hash, Percent, Info
} from 'lucide-react'
import { toast } from 'sonner'

interface NfeConfig {
  // Emitente
  cnpj: string
  razao_social: string
  nome_fantasia: string
  inscricao_estadual: string
  inscricao_municipal: string
  cnae: string
  crt: string
  // Endereco
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  codigo_municipio: string
  municipio: string
  uf: string
  cep: string
  telefone: string
  // NF-e
  ambiente: string
  serie: string
  proximo_numero: string
  // Impostos
  csosn_padrao: string
  aliquota_simples: string
  cfop_venda_interna: string
  cfop_venda_interestadual: string
  cfop_devolucao: string
  // Info complementar
  info_complementar: string
  // Certificado (read-only from API)
  cert_instalado: string
  cert_validade: string
  cert_valid_from: string
  cert_cnpj: string
  cert_subject: string
  cert_issuer: string
  cert_filename: string
}

const CSOSN_OPTIONS = [
  { value: '102', label: '102 - Tributada sem permissao de credito' },
  { value: '103', label: '103 - Isencao do ICMS para faixa de receita bruta' },
  { value: '300', label: '300 - Imune' },
  { value: '400', label: '400 - Nao tributada' },
  { value: '500', label: '500 - ICMS cobrado anteriormente por ST' },
  { value: '900', label: '900 - Outros' },
]

const UF_OPTIONS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

function formatCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0,2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
}

function CertExpiryBadge({ dateStr }: { dateStr: string }) {
  if (!dateStr) return null
  const expiry = new Date(dateStr)
  const now = new Date()
  const diffMs = expiry.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const formatted = expiry.toLocaleDateString('pt-BR')

  if (diffDays < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
        <XCircle className="h-3.5 w-3.5" />
        VENCIDO
      </span>
    )
  }
  if (diffDays <= 30) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
        <ShieldAlert className="h-3.5 w-3.5" />
        Vence em {diffDays} dias
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
      <CheckCircle className="h-3.5 w-3.5" />
      Valido ate {formatted}
    </span>
  )
}

export default function ConfigNfePage() {
  const [config, setConfig] = useState<NfeConfig>({
    cnpj: '', razao_social: '', nome_fantasia: '', inscricao_estadual: '', inscricao_municipal: '',
    cnae: '', crt: '1', logradouro: '', numero: '', complemento: '', bairro: '',
    codigo_municipio: '', municipio: '', uf: 'SP', cep: '', telefone: '',
    ambiente: '2', serie: '1', proximo_numero: '1',
    csosn_padrao: '102', aliquota_simples: '', cfop_venda_interna: '5102',
    cfop_venda_interestadual: '6102', cfop_devolucao: '5202',
    info_complementar: '',
    cert_instalado: '', cert_validade: '', cert_valid_from: '', cert_cnpj: '',
    cert_subject: '', cert_issuer: '', cert_filename: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testando, setTestando] = useState(false)
  const [sefazStatus, setSefazStatus] = useState<{ online: boolean; motivo: string } | null>(null)
  const [showProdWarning, setShowProdWarning] = useState(false)

  // Certificate upload
  const [showCertUpload, setShowCertUpload] = useState(false)
  const [certFile, setCertFile] = useState<File | null>(null)
  const [certPassword, setCertPassword] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/settings/nfe-config')
      .then(r => r.json())
      .then(d => { if (d.data) setConfig(prev => ({ ...prev, ...d.data })) })
      .catch(() => toast.error('Erro ao carregar configuracoes'))
      .finally(() => setLoading(false))
  }, [])

  function upd(field: string, value: string) {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    if (!config.cnpj || !config.inscricao_estadual) {
      toast.error('CNPJ e Inscricao Estadual sao obrigatorios')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/settings/nfe-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      toast.success('Configuracoes NF-e salvas com sucesso!')
    } catch (err: any) { toast.error(err.message || 'Erro ao salvar') }
    finally { setSaving(false) }
  }

  async function handleTestSefaz() {
    setTestando(true)
    setSefazStatus(null)
    try {
      const res = await fetch('/api/fiscal/nfe-status')
      const d = await res.json()
      setSefazStatus(d.data || { online: false, motivo: 'Erro' })
    } catch { setSefazStatus({ online: false, motivo: 'Erro de conexao' }) }
    finally { setTestando(false) }
  }

  async function handleCertUpload() {
    if (!certFile) { toast.error('Selecione o arquivo do certificado'); return }
    if (!certPassword.trim()) { toast.error('Digite a senha do certificado'); return }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('certificate', certFile)
      formData.append('password', certPassword)
      const res = await fetch('/api/fiscal/certificado', { method: 'POST', body: formData })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro ao instalar')
      toast.success('Certificado A1 instalado com sucesso!')
      setShowCertUpload(false)
      setCertFile(null)
      setCertPassword('')
      // Reload config to get new cert info
      const cfgRes = await fetch('/api/settings/nfe-config')
      const cfgData = await cfgRes.json()
      if (cfgData.data) setConfig(prev => ({ ...prev, ...cfgData.data }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao instalar certificado')
    } finally { setUploading(false) }
  }

  function handleAmbienteToggle() {
    if (config.ambiente === '2') {
      // Switching to production - show warning
      setShowProdWarning(true)
    } else {
      upd('ambiente', '2')
    }
  }

  function confirmProducao() {
    upd('ambiente', '1')
    setShowProdWarning(false)
  }

  const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors bg-white'
  const label = 'block text-xs font-medium text-gray-500 mb-1.5'
  const certInstalled = config.cert_instalado === 'true'
  const isProducao = config.ambiente === '1'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400 mr-3" />
        <span className="text-gray-500">Carregando configuracoes...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg border p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="h-6 w-6 text-blue-600" />
              Configuracoes NF-e
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Certificado digital, ambiente, impostos e dados fiscais</p>
          </div>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm transition-colors">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar Configuracoes'}
        </button>
      </div>

      {/* SEFAZ Status */}
      {sefazStatus && (
        <div className={`rounded-xl border p-4 flex items-center gap-3 ${sefazStatus.online ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          {sefazStatus.online ? <CheckCircle className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
          <div className="flex-1">
            <p className={`text-sm font-medium ${sefazStatus.online ? 'text-green-800' : 'text-red-800'}`}>
              {sefazStatus.online ? 'SEFAZ Online' : 'SEFAZ Indisponivel'}
            </p>
            <p className="text-xs text-gray-500">{sefazStatus.motivo}</p>
          </div>
        </div>
      )}

      {/* ======================== SECTION 1: Certificado Digital ======================== */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="border-b bg-gray-50/50 px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Certificado Digital A1
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Arquivo .pfx ou .p12 necessario para emissao de NF-e</p>
        </div>

        <div className="p-6">
          {certInstalled ? (
            <div className="space-y-4">
              {/* Certificate status card */}
              <div className="rounded-lg bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 p-5">
                <div className="flex items-start gap-4">
                  <div className="rounded-full bg-green-100 p-2.5">
                    <ShieldCheck className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-sm font-semibold text-green-800">Certificado Instalado</h3>
                      <CertExpiryBadge dateStr={config.cert_validade} />
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {config.cert_subject && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                          <span className="font-medium text-gray-500">Titular:</span>
                          <span className="truncate">{config.cert_subject}</span>
                        </div>
                      )}
                      {config.cert_cnpj && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Hash className="h-4 w-4 text-gray-400 shrink-0" />
                          <span className="font-medium text-gray-500">CNPJ:</span>
                          <span>{config.cert_cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')}</span>
                        </div>
                      )}
                      {config.cert_issuer && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Lock className="h-4 w-4 text-gray-400 shrink-0" />
                          <span className="font-medium text-gray-500">Emissor:</span>
                          <span className="truncate">{config.cert_issuer}</span>
                        </div>
                      )}
                      {config.cert_valid_from && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Calendar className="h-4 w-4 text-gray-400 shrink-0" />
                          <span className="font-medium text-gray-500">Valido desde:</span>
                          <span>{new Date(config.cert_valid_from).toLocaleDateString('pt-BR')}</span>
                        </div>
                      )}
                      {config.cert_validade && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Calendar className="h-4 w-4 text-gray-400 shrink-0" />
                          <span className="font-medium text-gray-500">Valido ate:</span>
                          <span>{new Date(config.cert_validade).toLocaleDateString('pt-BR')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowCertUpload(true); setCertFile(null); setCertPassword('') }}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <Upload className="h-4 w-4" /> Substituir Certificado
                </button>
                <button type="button" onClick={handleTestSefaz} disabled={testando}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                  {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Testar Conexao SEFAZ
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="rounded-full bg-amber-100 p-3 w-fit mx-auto mb-3">
                <ShieldAlert className="h-8 w-8 text-amber-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-700">Nenhum certificado instalado</h3>
              <p className="text-sm text-gray-500 mt-1 mb-4">
                Instale o certificado digital A1 (.pfx ou .p12) para emitir notas fiscais
              </p>
              <button type="button" onClick={() => { setShowCertUpload(true); setCertFile(null); setCertPassword('') }}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm transition-colors">
                <Upload className="h-4 w-4" /> Instalar Certificado A1
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ======================== SECTION 2: Ambiente ======================== */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="border-b bg-gray-50/50 px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <ToggleLeft className="h-5 w-5 text-blue-600" />
            Ambiente de Emissao
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Alterne entre homologacao (testes) e producao (notas reais)</p>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-6">
            {/* Toggle switch */}
            <button
              type="button"
              onClick={handleAmbienteToggle}
              className="relative flex items-center"
              title="Alternar ambiente"
            >
              <div className={`w-16 h-8 rounded-full transition-colors duration-300 ${isProducao ? 'bg-green-500' : 'bg-amber-400'}`}>
                <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 ${isProducao ? 'translate-x-9' : 'translate-x-1'}`} />
              </div>
            </button>

            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${
                  isProducao
                    ? 'bg-green-100 text-green-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {isProducao ? 'Producao' : 'Homologacao'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {isProducao
                  ? 'Notas fiscais serao emitidas com validade juridica na SEFAZ de producao.'
                  : 'Notas fiscais serao emitidas apenas como teste (sem validade juridica).'}
              </p>
            </div>
          </div>

          {isProducao && (
            <div className="mt-4 rounded-lg bg-green-50 border border-green-200 p-3 flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <p className="text-xs text-green-700">
                Ambiente de producao ativo. Todas as NF-e emitidas terao validade fiscal. Certifique-se de que os dados do emitente estao corretos antes de emitir.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ======================== SECTION 3: Simples Nacional Defaults ======================== */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="border-b bg-gray-50/50 px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Percent className="h-5 w-5 text-blue-600" />
            Impostos Padrao - Simples Nacional
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Valores padrao para novas NF-e (podem ser alterados na emissao)</p>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="sm:col-span-2">
              <label className={label}>CSOSN Padrao</label>
              <select value={config.csosn_padrao} onChange={e => upd('csosn_padrao', e.target.value)} title="CSOSN" className={inp}>
                {CSOSN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Aliquota Simples Nacional (%)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={config.aliquota_simples}
                  onChange={e => upd('aliquota_simples', e.target.value)}
                  placeholder="Ex: 6.00"
                  className={inp}
                />
                <span className="absolute right-3 top-2.5 text-sm text-gray-400">%</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Exibido nas informacoes complementares da NF-e</p>
            </div>
            <div>
              <label className={label}>CFOP Venda Interna (mesma UF)</label>
              <input value={config.cfop_venda_interna} onChange={e => upd('cfop_venda_interna', e.target.value)} placeholder="5102" className={inp} />
            </div>
            <div>
              <label className={label}>CFOP Venda Interestadual</label>
              <input value={config.cfop_venda_interestadual} onChange={e => upd('cfop_venda_interestadual', e.target.value)} placeholder="6102" className={inp} />
            </div>
            <div>
              <label className={label}>CFOP Devolucao</label>
              <input value={config.cfop_devolucao} onChange={e => upd('cfop_devolucao', e.target.value)} placeholder="5202" className={inp} />
            </div>
          </div>
        </div>
      </div>

      {/* ======================== SECTION 4: Dados Fiscais da Empresa ======================== */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="border-b bg-gray-50/50 px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            Dados Fiscais da Empresa
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Informacoes do emitente utilizadas nas NF-e</p>
        </div>

        <div className="p-6 space-y-5">
          {/* Identificacao */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Identificacao</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className={label}>CNPJ *</label>
                <input value={config.cnpj} onChange={e => upd('cnpj', formatCnpj(e.target.value))} placeholder="00.000.000/0001-00" className={inp} />
              </div>
              <div>
                <label className={label}>Inscricao Estadual (IE) *</label>
                <input value={config.inscricao_estadual} onChange={e => upd('inscricao_estadual', e.target.value)} placeholder="Inscricao Estadual" className={inp} />
              </div>
              <div>
                <label className={label}>Inscricao Municipal (IM)</label>
                <input value={config.inscricao_municipal} onChange={e => upd('inscricao_municipal', e.target.value)} placeholder="Inscricao Municipal" className={inp} />
              </div>
              <div>
                <label className={label}>Regime Tributario</label>
                <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600">
                  {config.crt === '1' ? '1 - Simples Nacional' : config.crt === '2' ? '2 - SN Excesso Sublimite' : '3 - Regime Normal'}
                </div>
              </div>
              <div>
                <label className={label}>Serie NF-e</label>
                <input value={config.serie} onChange={e => upd('serie', e.target.value)} placeholder="1" className={inp} />
              </div>
              <div>
                <label className={label}>Proximo Numero NF-e</label>
                <input
                  type="number"
                  min="1"
                  value={config.proximo_numero}
                  onChange={e => upd('proximo_numero', e.target.value)}
                  placeholder="1"
                  className={inp}
                />
              </div>
            </div>
          </div>

          {/* Razao Social */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Razao Social</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={label}>Razao Social</label>
                <input value={config.razao_social} onChange={e => upd('razao_social', e.target.value)} placeholder="Razao Social da empresa" className={inp} />
              </div>
              <div>
                <label className={label}>Nome Fantasia</label>
                <input value={config.nome_fantasia} onChange={e => upd('nome_fantasia', e.target.value)} placeholder="Nome Fantasia" className={inp} />
              </div>
              <div>
                <label className={label}>CNAE</label>
                <input value={config.cnae} onChange={e => upd('cnae', e.target.value)} placeholder="4751201" className={inp} />
              </div>
              <div>
                <label className={label}>Telefone</label>
                <input value={config.telefone} onChange={e => upd('telefone', e.target.value)} placeholder="(11) 3136-0415" className={inp} />
              </div>
            </div>
          </div>

          {/* Endereco */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Endereco do Emitente</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className={label}>Logradouro</label>
                <input value={config.logradouro} onChange={e => upd('logradouro', e.target.value)} placeholder="Rua, Av, etc." className={inp} />
              </div>
              <div>
                <label className={label}>Numero</label>
                <input value={config.numero} onChange={e => upd('numero', e.target.value)} placeholder="Numero" className={inp} />
              </div>
              <div>
                <label className={label}>Complemento</label>
                <input value={config.complemento} onChange={e => upd('complemento', e.target.value)} placeholder="Sala, andar, etc." className={inp} />
              </div>
              <div>
                <label className={label}>Bairro</label>
                <input value={config.bairro} onChange={e => upd('bairro', e.target.value)} placeholder="Bairro" className={inp} />
              </div>
              <div>
                <label className={label}>CEP</label>
                <input value={config.cep} onChange={e => upd('cep', e.target.value)} placeholder="00000-000" className={inp} />
              </div>
              <div>
                <label className={label}>Municipio</label>
                <input value={config.municipio} onChange={e => upd('municipio', e.target.value)} placeholder="Sao Paulo" className={inp} />
              </div>
              <div>
                <label className={label}>Cod. Municipio IBGE</label>
                <input value={config.codigo_municipio} onChange={e => upd('codigo_municipio', e.target.value)} placeholder="3550308" className={inp} />
              </div>
              <div>
                <label className={label}>UF</label>
                <select value={config.uf} onChange={e => upd('uf', e.target.value)} title="UF" className={inp}>
                  {UF_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ======================== Info Complementar ======================== */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="border-b bg-gray-50/50 px-6 py-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-600" />
            Informacoes Complementares
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Texto padrao no campo de informacoes adicionais da NF-e</p>
        </div>

        <div className="p-6">
          <textarea
            value={config.info_complementar}
            onChange={e => upd('info_complementar', e.target.value)}
            placeholder="Documento emitido por ME ou EPP optante pelo Simples Nacional. Nao gera direito a credito fiscal de IPI."
            rows={3}
            className={inp}
          />
          <p className="text-xs text-gray-400 mt-2">
            Esse texto aparecera em todas as NF-e emitidas. Voce pode sobrescrever na hora da emissao.
          </p>
        </div>
      </div>

      {/* ======================== Bottom Save ======================== */}
      <div className="flex justify-end pt-2">
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-8 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm transition-colors">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar Configuracoes'}
        </button>
      </div>

      {/* ======================== MODALS ======================== */}

      {/* Certificate Upload Modal */}
      {showCertUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCertUpload(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
              <Upload className="h-5 w-5 text-blue-600" />
              {certInstalled ? 'Substituir Certificado' : 'Instalar Certificado A1'}
            </h2>
            <p className="text-xs text-gray-500 mb-5">Arquivo .pfx ou .p12 (maximo 50KB)</p>

            <div className="space-y-4">
              <input ref={fileRef} type="file" accept=".pfx,.p12" onChange={e => setCertFile(e.target.files?.[0] || null)} className="hidden" aria-label="Arquivo do certificado" />

              {certFile ? (
                <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileKey className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-blue-800">{certFile.name}</p>
                      <p className="text-xs text-blue-600">{(certFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => { setCertFile(null); if (fileRef.current) fileRef.current.value = '' }}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium">Trocar</button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full px-4 py-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-colors text-center">
                  <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600">Clique para selecionar o arquivo</p>
                  <p className="text-xs text-gray-400 mt-1">Formatos: .pfx, .p12</p>
                </button>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Senha do certificado *</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input type="password" value={certPassword} onChange={e => setCertPassword(e.target.value)}
                    placeholder="Senha fornecida pela certificadora"
                    className="w-full pl-10 pr-3 py-2 border rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors" />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowCertUpload(false)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 transition-colors">Cancelar</button>
              <button type="button" onClick={handleCertUpload} disabled={uploading || !certFile || !certPassword}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium transition-colors">
                {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {uploading ? 'Instalando...' : 'Instalar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Production Warning Modal */}
      {showProdWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowProdWarning(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-full bg-amber-100 p-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Ativar Producao?</h2>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              Ao mudar para <strong>producao</strong>, todas as NF-e emitidas terao validade juridica e fiscal.
            </p>
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              Certifique-se de que o certificado digital esta instalado e os dados do emitente estao corretos antes de continuar.
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowProdWarning(false)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 transition-colors">Cancelar</button>
              <button type="button" onClick={confirmProducao}
                className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition-colors">
                Ativar Producao
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
