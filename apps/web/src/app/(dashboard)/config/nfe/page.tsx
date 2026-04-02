'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, FileText, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'

interface NfeConfig {
  // Emitente
  cnpj: string
  razao_social: string
  nome_fantasia: string
  inscricao_estadual: string
  inscricao_municipal: string
  cnae: string
  crt: string // 1=Simples, 2=SN Excesso, 3=Normal
  // Endereço
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
  ambiente: string // 1=Producao, 2=Homologacao
  serie: string
  proximo_numero: string
  // Impostos padrão (Simples Nacional)
  csosn_padrao: string
  cfop_venda_interna: string
  cfop_venda_interestadual: string
  cfop_devolucao: string
  // Informações complementares
  info_complementar: string
  // Certificado
  cert_instalado: boolean
  cert_validade: string
  cert_cnpj: string
}

const CRT_OPTIONS = [
  { value: '1', label: '1 — Simples Nacional' },
  { value: '2', label: '2 — Simples Nacional (excesso)' },
  { value: '3', label: '3 — Regime Normal' },
]

const CSOSN_OPTIONS = [
  { value: '102', label: '102 — Tributada sem permissao de credito' },
  { value: '103', label: '103 — Isencao do ICMS para faixa de receita bruta' },
  { value: '300', label: '300 — Imune' },
  { value: '400', label: '400 — Nao tributada pelo Simples Nacional' },
  { value: '500', label: '500 — ICMS cobrado anteriormente por ST' },
  { value: '900', label: '900 — Outros' },
]

const UF_OPTIONS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

export default function ConfigNfePage() {
  const [config, setConfig] = useState<NfeConfig>({
    cnpj: '', razao_social: '', nome_fantasia: '', inscricao_estadual: '', inscricao_municipal: '',
    cnae: '', crt: '1', logradouro: '', numero: '', complemento: '', bairro: '',
    codigo_municipio: '', municipio: '', uf: 'SP', cep: '', telefone: '',
    ambiente: '2', serie: '1', proximo_numero: '1',
    csosn_padrao: '102', cfop_venda_interna: '5102', cfop_venda_interestadual: '6102', cfop_devolucao: '5202',
    info_complementar: '', cert_instalado: false, cert_validade: '', cert_cnpj: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testando, setTestando] = useState(false)
  const [sefazStatus, setSefazStatus] = useState<{ online: boolean; motivo: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/nfe-config')
      .then(r => r.json())
      .then(d => { if (d.data) setConfig(prev => ({ ...prev, ...d.data })) })
      .catch(() => toast.error('Erro ao carregar configuracoes'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    if (!config.cnpj || !config.razao_social || !config.inscricao_estadual) {
      toast.error('CNPJ, Razao Social e IE sao obrigatorios')
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
      toast.success('Configuracoes NF-e salvas!')
    } catch (err: any) { toast.error(err.message) }
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

  function upd(field: string, value: string) { setConfig(prev => ({ ...prev, [field]: value })) }
  const inp = 'w-full px-3 py-2 border rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200'

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/config" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><ArrowLeft className="h-5 w-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileText className="h-6 w-6" /> Configuracoes NF-e</h1>
            <p className="text-sm text-gray-500">Dados do emitente, impostos e certificado digital</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleTestSefaz} disabled={testando}
            className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {testando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Testar SEFAZ
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* SEFAZ Status */}
      {sefazStatus && (
        <div className={`rounded-lg border p-4 flex items-center gap-3 ${sefazStatus.online ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          {sefazStatus.online ? <CheckCircle className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
          <div>
            <p className={`text-sm font-medium ${sefazStatus.online ? 'text-green-800' : 'text-red-800'}`}>
              {sefazStatus.online ? 'SEFAZ Online' : 'SEFAZ Indisponivel'}
            </p>
            <p className="text-xs text-gray-500">{sefazStatus.motivo}</p>
          </div>
        </div>
      )}

      {/* Certificado */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-3">Certificado Digital A1</h2>
        {config.cert_instalado ? (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4">
            <p className="text-sm text-green-800 font-medium">Certificado instalado</p>
            <p className="text-xs text-green-600 mt-1">CNPJ: {config.cert_cnpj} | Validade: {config.cert_validade}</p>
          </div>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
            <p className="text-sm text-amber-800 font-medium">Certificado nao instalado</p>
            <p className="text-xs text-amber-600 mt-1">Instale em <Link href="/config/certificado" className="underline">Configuracoes &gt; Certificado A1</Link></p>
          </div>
        )}
      </div>

      {/* Emitente */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Dados do Emitente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div><label className="block text-xs text-gray-500 mb-1">CNPJ *</label><input value={config.cnpj} onChange={e => upd('cnpj', e.target.value)} placeholder="00.000.000/0001-00" className={inp} /></div>
          <div className="sm:col-span-2"><label className="block text-xs text-gray-500 mb-1">Razao Social *</label><input value={config.razao_social} onChange={e => upd('razao_social', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Nome Fantasia</label><input value={config.nome_fantasia} onChange={e => upd('nome_fantasia', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Inscricao Estadual *</label><input value={config.inscricao_estadual} onChange={e => upd('inscricao_estadual', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Inscricao Municipal</label><input value={config.inscricao_municipal} onChange={e => upd('inscricao_municipal', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">CNAE</label><input value={config.cnae} onChange={e => upd('cnae', e.target.value)} placeholder="4751201" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Regime Tributario (CRT) *</label>
            <select value={config.crt} onChange={e => upd('crt', e.target.value)} title="CRT" className={inp}>
              {CRT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Endereço */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Endereco do Emitente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2"><label className="block text-xs text-gray-500 mb-1">Logradouro</label><input value={config.logradouro} onChange={e => upd('logradouro', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Numero</label><input value={config.numero} onChange={e => upd('numero', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Complemento</label><input value={config.complemento} onChange={e => upd('complemento', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Bairro</label><input value={config.bairro} onChange={e => upd('bairro', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">CEP</label><input value={config.cep} onChange={e => upd('cep', e.target.value)} placeholder="00000-000" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Municipio</label><input value={config.municipio} onChange={e => upd('municipio', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Cod. Municipio IBGE</label><input value={config.codigo_municipio} onChange={e => upd('codigo_municipio', e.target.value)} placeholder="3550308" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">UF</label>
            <select value={config.uf} onChange={e => upd('uf', e.target.value)} title="UF" className={inp}>
              {UF_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">Telefone</label><input value={config.telefone} onChange={e => upd('telefone', e.target.value)} className={inp} /></div>
        </div>
      </div>

      {/* NF-e */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Parametros NF-e</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div><label className="block text-xs text-gray-500 mb-1">Ambiente</label>
            <select value={config.ambiente} onChange={e => upd('ambiente', e.target.value)} title="Ambiente" className={inp}>
              <option value="2">Homologacao (testes)</option>
              <option value="1">Producao</option>
            </select>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">Serie</label><input value={config.serie} onChange={e => upd('serie', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Proximo Numero</label><input value={config.proximo_numero} onChange={e => upd('proximo_numero', e.target.value)} className={inp} /></div>
        </div>
      </div>

      {/* Impostos */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Impostos Padrao</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="block text-xs text-gray-500 mb-1">CSOSN Padrao (Simples Nacional)</label>
            <select value={config.csosn_padrao} onChange={e => upd('csosn_padrao', e.target.value)} title="CSOSN" className={inp}>
              {CSOSN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">CFOP Venda Interna (mesma UF)</label><input value={config.cfop_venda_interna} onChange={e => upd('cfop_venda_interna', e.target.value)} placeholder="5102" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">CFOP Venda Interestadual</label><input value={config.cfop_venda_interestadual} onChange={e => upd('cfop_venda_interestadual', e.target.value)} placeholder="6102" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">CFOP Devolucao</label><input value={config.cfop_devolucao} onChange={e => upd('cfop_devolucao', e.target.value)} placeholder="5202" className={inp} /></div>
        </div>
      </div>

      {/* Info complementar */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Informacoes Complementares</h2>
        <textarea value={config.info_complementar} onChange={e => upd('info_complementar', e.target.value)}
          placeholder="Texto que aparece no campo de informacoes complementares de todas as NF-e..."
          rows={3} className={inp} />
        <p className="text-xs text-gray-400 mt-1">Ex: "Documento emitido por ME ou EPP optante pelo Simples Nacional..."</p>
      </div>
    </div>
  )
}
