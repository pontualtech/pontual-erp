'use client'

import { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Loader2, Palette, Upload, X, Sun, Moon } from 'lucide-react'

const COLORS = [
  { name: 'Azul', value: '#2563EB', bg: 'bg-blue-600' },
  { name: 'Verde', value: '#059669', bg: 'bg-emerald-600' },
  { name: 'Roxo', value: '#7C3AED', bg: 'bg-violet-600' },
  { name: 'Vermelho', value: '#DC2626', bg: 'bg-red-600' },
  { name: 'Laranja', value: '#EA580C', bg: 'bg-orange-600' },
  { name: 'Rosa', value: '#DB2777', bg: 'bg-pink-600' },
  { name: 'Índigo', value: '#4F46E5', bg: 'bg-indigo-600' },
  { name: 'Cinza', value: '#374151', bg: 'bg-gray-700' },
]

export default function AparenciaPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [primaryColor, setPrimaryColor] = useState('#2563EB')
  const [companyName, setCompanyName] = useState('PontualERP')
  const [logoUrl, setLogoUrl] = useState('')
  const [footerText, setFooterText] = useState('')
  const [pdfHeader, setPdfHeader] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        const data = d.data || {}
        const flat: Record<string, string> = {}
        for (const group of Object.values(data) as any[]) {
          for (const [key, val] of Object.entries(group)) {
            flat[key] = (val as any)?.value ?? ''
          }
        }
        if (flat['aparencia.cor_primaria']) setPrimaryColor(flat['aparencia.cor_primaria'])
        if (flat['aparencia.nome_sistema']) setCompanyName(flat['aparencia.nome_sistema'])
        if (flat['aparencia.logo_url']) setLogoUrl(flat['aparencia.logo_url'])
        if (flat['aparencia.rodape_pdf']) setFooterText(flat['aparencia.rodape_pdf'])
        if (flat['aparencia.cabecalho_pdf']) setPdfHeader(flat['aparencia.cabecalho_pdf'])
        if (flat['aparencia.tema']) setTheme(flat['aparencia.tema'] as 'light' | 'dark')
        if (flat['company_name']) setCompanyName(flat['company_name'])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const settings = [
        { key: 'aparencia.cor_primaria', value: primaryColor, type: 'string', group: 'aparencia' },
        { key: 'aparencia.nome_sistema', value: companyName, type: 'string', group: 'aparencia' },
        { key: 'aparencia.logo_url', value: logoUrl, type: 'string', group: 'aparencia' },
        { key: 'aparencia.rodape_pdf', value: footerText, type: 'string', group: 'aparencia' },
        { key: 'aparencia.cabecalho_pdf', value: pdfHeader, type: 'string', group: 'aparencia' },
        { key: 'aparencia.tema', value: theme, type: 'string', group: 'aparencia' },
      ]
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      toast.success('Aparência salva!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>

  const inp = "w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors"

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Aparência</h1>
          <p className="text-sm text-gray-500">Personalizar tema, logo e textos do sistema</p>
        </div>
      </div>

      {/* Theme mode */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          {theme === 'dark' ? <Moon className="h-4 w-4 text-indigo-500" /> : <Sun className="h-4 w-4 text-amber-500" />}
          Tema
        </h2>
        <div className="flex gap-3">
          <button type="button" onClick={() => setTheme('light')}
            className={`flex-1 flex items-center justify-center gap-3 py-4 rounded-lg border-2 transition-all ${
              theme === 'light' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-gray-300'
            }`}>
            <Sun className={`h-6 w-6 ${theme === 'light' ? 'text-amber-500' : 'text-gray-400'}`} />
            <div className="text-left">
              <p className={`font-medium ${theme === 'light' ? 'text-amber-800' : 'text-gray-600'}`}>Claro</p>
              <p className="text-xs text-gray-500">Fundo branco, texto escuro</p>
            </div>
          </button>
          <button type="button" onClick={() => setTheme('dark')}
            className={`flex-1 flex items-center justify-center gap-3 py-4 rounded-lg border-2 transition-all ${
              theme === 'dark' ? 'border-indigo-400 bg-gray-900' : 'border-gray-200 hover:border-gray-300'
            }`}>
            <Moon className={`h-6 w-6 ${theme === 'dark' ? 'text-indigo-400' : 'text-gray-400'}`} />
            <div className="text-left">
              <p className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-600'}`}>Escuro</p>
              <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Fundo escuro, menos cansaço visual</p>
            </div>
          </button>
        </div>
        {theme === 'dark' && (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-md">
            O tema escuro será aplicado após salvar e recarregar a página. Implementação progressiva — algumas telas podem ter ajustes visuais pendentes.
          </p>
        )}
      </div>

      {/* Color theme */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Palette className="h-4 w-4 text-blue-600" /> Cor Principal
        </h2>
        <div className="flex flex-wrap gap-3">
          {COLORS.map(c => (
            <button key={c.value} type="button" onClick={() => setPrimaryColor(c.value)}
              title={c.name}
              className={`w-10 h-10 rounded-full ${c.bg} transition-all ${
                primaryColor === c.value ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'
              }`} />
          ))}
          <div className="flex items-center gap-2">
            <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
              title="Cor personalizada" className="w-10 h-10 rounded-lg border cursor-pointer" />
            <span className="text-xs text-gray-400 font-mono">{primaryColor}</span>
          </div>
        </div>
        {/* Preview */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
          <span className="text-sm text-gray-500">Preview:</span>
          <button className="px-4 py-1.5 text-sm text-white rounded-md font-medium" style={{ backgroundColor: primaryColor }}>
            Botão Exemplo
          </button>
          <span className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: primaryColor }}>
            Badge
          </span>
        </div>
      </div>

      {/* Branding */}
      <div className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Marca</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome exibido no sistema</label>
          <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
            placeholder="PontualERP" className={inp} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Logo da Empresa</label>
          <input ref={logoFileRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" title="Logo da empresa" className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setUploadingLogo(true)
              try {
                const formData = new FormData()
                formData.append('logo', file)
                const res = await fetch('/api/upload/logo', { method: 'POST', body: formData })
                const d = await res.json()
                if (!res.ok) throw new Error(d.error || 'Erro')
                setLogoUrl(d.data.url)
                toast.success('Logo enviado!')
              } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro no upload') }
              finally { setUploadingLogo(false) }
            }} />
          {logoUrl ? (
            <div className="flex items-center gap-4 p-4 rounded-lg bg-gray-50 border">
              <img src={logoUrl} alt="Logo" className="h-12 max-w-[200px] object-contain" />
              <div className="flex gap-2">
                <button type="button" onClick={() => logoFileRef.current?.click()} disabled={uploadingLogo}
                  className="px-3 py-1.5 text-xs border rounded-md hover:bg-white text-gray-600 font-medium">
                  {uploadingLogo ? 'Enviando...' : 'Trocar'}
                </button>
                <button type="button" onClick={() => setLogoUrl('')}
                  className="px-3 py-1.5 text-xs border border-red-200 rounded-md hover:bg-red-50 text-red-600 font-medium">
                  Remover
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => logoFileRef.current?.click()} disabled={uploadingLogo}
              className="w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-colors text-center">
              <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
              <p className="text-sm text-gray-600">{uploadingLogo ? 'Enviando...' : 'Clique para enviar o logo'}</p>
              <p className="text-xs text-gray-400 mt-1">PNG, JPG, SVG ou WebP (máx. 500KB)</p>
            </button>
          )}
        </div>
      </div>

      {/* PDF */}
      <div className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Impressão (PDF)</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cabeçalho customizado</label>
          <textarea value={pdfHeader} onChange={e => setPdfHeader(e.target.value)}
            rows={2} placeholder="Texto que aparece no topo das OS impressas..."
            className={inp + " resize-none"} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Rodapé customizado</label>
          <textarea value={footerText} onChange={e => setFooterText(e.target.value)}
            rows={2} placeholder="Termos e condições, garantia, etc..."
            className={inp + " resize-none"} />
        </div>
      </div>

      {/* Save */}
      <div className="flex gap-3">
        <Link href="/config" className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50">Voltar</Link>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Salvando...' : 'Salvar Aparência'}
        </button>
      </div>
    </div>
  )
}
