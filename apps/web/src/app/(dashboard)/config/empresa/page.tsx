'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, Building2, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'

interface EmpresaConfig {
  // Dados da Empresa
  company_name: string
  razao_social: string
  nome_fantasia: string
  cnpj: string
  ie: string
  im: string
  cnae: string
  // Endereco
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  municipio: string
  cod_municipio: string
  uf: string
  cep: string
  // Contato
  phone: string
  whatsapp: string
  email: string
  website: string
  // Email SMTP
  from_name: string
  from_address: string
  resend_configured: string
  // Portal do Cliente
  quote_url: string
  portal_url: string
  app_url_env: string
  // NFS-e Servico
  nfse_codigo_municipio: string
  aliquota_iss: string
  codigo_servico: string
  crt: string
}

const CRT_OPTIONS = [
  { value: '1', label: '1 — Simples Nacional' },
  { value: '2', label: '2 — Simples Nacional (excesso)' },
  { value: '3', label: '3 — Regime Normal' },
]

const UF_OPTIONS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

export default function ConfigEmpresaPage() {
  const [config, setConfig] = useState<EmpresaConfig>({
    company_name: '', razao_social: '', nome_fantasia: '', cnpj: '', ie: '', im: '', cnae: '',
    logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', cod_municipio: '', uf: 'SP', cep: '',
    phone: '', whatsapp: '', email: '', website: '',
    from_name: '', from_address: '', resend_configured: 'false',
    quote_url: '', portal_url: '', app_url_env: '',
    nfse_codigo_municipio: '', aliquota_iss: '', codigo_servico: '', crt: '1',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/empresa-config')
      .then(r => r.json())
      .then(d => { if (d.data) setConfig(prev => ({ ...prev, ...d.data })) })
      .catch(() => toast.error('Erro ao carregar configuracoes'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/empresa-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      toast.success('Configuracoes da empresa salvas!')
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
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
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Building2 className="h-6 w-6" /> Dados da Empresa</h1>
            <p className="text-sm text-gray-500">Cadastro, endereco, contato, email e configuracoes fiscais</p>
          </div>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {/* Secao 1: Dados da Empresa */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Dados da Empresa</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2"><label className="block text-xs text-gray-500 mb-1">Razao Social</label><input title="Razao Social" value={config.razao_social} onChange={e => upd('razao_social', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Nome Fantasia</label><input title="Nome Fantasia" value={config.nome_fantasia} onChange={e => upd('nome_fantasia', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">CNPJ</label><input value={config.cnpj} onChange={e => upd('cnpj', e.target.value)} placeholder="00.000.000/0001-00" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Inscricao Estadual</label><input title="Inscricao Estadual" value={config.ie} onChange={e => upd('ie', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Inscricao Municipal</label><input title="Inscricao Municipal" value={config.im} onChange={e => upd('im', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">CNAE</label><input value={config.cnae} onChange={e => upd('cnae', e.target.value)} placeholder="4751201" className={inp} /></div>
        </div>
      </div>

      {/* Secao 2: Endereco */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Endereco</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2"><label className="block text-xs text-gray-500 mb-1">Logradouro</label><input title="Logradouro" value={config.logradouro} onChange={e => upd('logradouro', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Numero</label><input title="Numero" value={config.numero} onChange={e => upd('numero', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Complemento</label><input title="Complemento" value={config.complemento} onChange={e => upd('complemento', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Bairro</label><input title="Bairro" value={config.bairro} onChange={e => upd('bairro', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">CEP</label><input value={config.cep} onChange={e => upd('cep', e.target.value)} placeholder="00000-000" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Municipio</label><input title="Municipio" value={config.municipio} onChange={e => upd('municipio', e.target.value)} className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Cod. Municipio IBGE</label><input value={config.cod_municipio} onChange={e => upd('cod_municipio', e.target.value)} placeholder="3550308" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">UF</label>
            <select value={config.uf} onChange={e => upd('uf', e.target.value)} title="UF" className={inp}>
              {UF_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Secao 3: Contato */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Contato</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="block text-xs text-gray-500 mb-1">Telefone</label><input value={config.phone} onChange={e => upd('phone', e.target.value)} placeholder="(11) 2626-3841" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">WhatsApp</label><input value={config.whatsapp} onChange={e => upd('whatsapp', e.target.value)} placeholder="551126263841" className={inp} />
            <p className="text-xs text-gray-400 mt-1">Numero com DDD, ex: 551126263841</p>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">Email</label><input type="email" value={config.email} onChange={e => upd('email', e.target.value)} placeholder="contato@empresa.com.br" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Website</label><input value={config.website} onChange={e => upd('website', e.target.value)} placeholder="https://empresa.com.br" className={inp} /></div>
        </div>
      </div>

      {/* Secao 4: Email (SMTP) */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Email (SMTP)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="block text-xs text-gray-500 mb-1">Remetente Nome</label><input value={config.from_name} onChange={e => upd('from_name', e.target.value)} placeholder="Minha Empresa" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Remetente Email</label><input type="email" value={config.from_address} onChange={e => upd('from_address', e.target.value)} placeholder="contato@empresa.com.br" className={inp} /></div>
        </div>
        <div className="mt-4">
          <div className={`rounded-lg border p-3 flex items-center gap-2 ${config.resend_configured === 'true' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
            {config.resend_configured === 'true'
              ? <><CheckCircle className="h-4 w-4 text-green-600" /><span className="text-sm text-green-800">Resend API Key configurada (env RESEND_API_KEY)</span></>
              : <><XCircle className="h-4 w-4 text-amber-600" /><span className="text-sm text-amber-800">Resend API Key nao configurada — adicione RESEND_API_KEY nas variaveis de ambiente</span></>
            }
          </div>
          <p className="text-xs text-gray-400 mt-2">O email e enviado via Resend. O remetente sera: &quot;{config.from_name || 'Empresa'} &lt;{config.from_address || 'email@empresa.com'}&gt;&quot;</p>
        </div>
      </div>

      {/* Secao 5: Portal do Cliente */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">Portal do Cliente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="block text-xs text-gray-500 mb-1">URL de Consulta de OS</label><input value={config.quote_url} onChange={e => upd('quote_url', e.target.value)} placeholder="https://empresa.com.br/#consulta-os" className={inp} />
            <p className="text-xs text-gray-400 mt-1">Link enviado ao cliente para acompanhar a OS</p>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">URL do Portal</label><input value={config.portal_url} onChange={e => upd('portal_url', e.target.value)} placeholder="https://app.empresa.com.br" className={inp} />
            {config.app_url_env && !config.portal_url && (
              <p className="text-xs text-gray-400 mt-1">Env NEXT_PUBLIC_APP_URL: {config.app_url_env}</p>
            )}
          </div>
        </div>
      </div>

      {/* Secao 6: NFS-e Servico */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-gray-900 mb-4">NFS-e Servico</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div><label className="block text-xs text-gray-500 mb-1">Codigo do Municipio</label><input value={config.nfse_codigo_municipio} onChange={e => upd('nfse_codigo_municipio', e.target.value)} placeholder="3550308" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">CCM / Inscricao Municipal</label><input title="CCM / Inscricao Municipal" value={config.im} disabled className={inp + ' bg-gray-50'} />
            <p className="text-xs text-gray-400 mt-1">Mesmo valor do campo acima (Dados da Empresa)</p>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">Aliquota ISS padrao (%)</label><input value={config.aliquota_iss} onChange={e => upd('aliquota_iss', e.target.value)} placeholder="5.00" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Codigo de Servico padrao</label><input value={config.codigo_servico} onChange={e => upd('codigo_servico', e.target.value)} placeholder="14.01" className={inp} /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Regime Tributario (CRT)</label>
            <select value={config.crt} onChange={e => upd('crt', e.target.value)} title="CRT" className={inp}>
              {CRT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
