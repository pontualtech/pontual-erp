'use client'

import { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Shield, ShieldCheck, ShieldX, Upload, Trash2, Loader2, FileKey, Lock, Calendar, Building2 } from 'lucide-react'

interface CertInfo {
  installed: boolean
  filename?: string
  uploaded_at?: string
  expires_at?: string
  subject?: string
  issuer?: string
  has_password?: boolean
}

export default function CertificadoPage() {
  const [cert, setCert] = useState<CertInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [password, setPassword] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function loadCert() {
    setLoading(true)
    fetch('/api/fiscal/certificado')
      .then(r => r.json())
      .then(d => setCert(d.data ?? { installed: false }))
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCert() }, [])

  async function handleUpload() {
    if (!selectedFile) { toast.error('Selecione o arquivo do certificado'); return }
    if (!password.trim()) { toast.error('Digite a senha do certificado'); return }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('certificate', selectedFile)
      formData.append('password', password)

      const res = await fetch('/api/fiscal/certificado', { method: 'POST', body: formData })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Erro ao instalar')

      toast.success('Certificado A1 instalado com sucesso!')
      setShowUpload(false)
      setSelectedFile(null)
      setPassword('')
      loadCert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch('/api/fiscal/certificado', { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erro') }
      toast.success('Certificado removido')
      setShowDelete(false)
      loadCert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Certificado Digital A1</h1>
          <p className="text-sm text-gray-500">Necessário para emissão de NF-e e NFS-e</p>
        </div>
      </div>

      {/* Status card */}
      {cert?.installed ? (
        <div className="rounded-lg border-2 border-green-200 bg-green-50 p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-green-100 p-3">
              <ShieldCheck className="h-8 w-8 text-green-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-green-800">Certificado Instalado</h2>
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <FileKey className="h-4 w-4" />
                  <span className="font-medium">Arquivo:</span>
                  <span>{cert.filename}</span>
                </div>
                {cert.uploaded_at && (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <Calendar className="h-4 w-4" />
                    <span className="font-medium">Instalado em:</span>
                    <span>{new Date(cert.uploaded_at).toLocaleString('pt-BR')}</span>
                  </div>
                )}
                {cert.expires_at && (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <Calendar className="h-4 w-4" />
                    <span className="font-medium">Validade:</span>
                    <span>{new Date(cert.expires_at).toLocaleDateString('pt-BR')}</span>
                  </div>
                )}
                {cert.subject && (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <Building2 className="h-4 w-4" />
                    <span className="font-medium">Titular:</span>
                    <span>{cert.subject}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <Lock className="h-4 w-4" />
                  <span className="font-medium">Senha:</span>
                  <span>{cert.has_password ? 'Configurada' : 'Não definida'}</span>
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button type="button" onClick={() => { setShowUpload(true); setSelectedFile(null); setPassword('') }}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 font-medium">
                  <Upload className="h-4 w-4" /> Substituir Certificado
                </button>
                <button type="button" onClick={() => setShowDelete(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm border border-red-200 text-red-600 rounded-md hover:bg-red-50 font-medium">
                  <Trash2 className="h-4 w-4" /> Desinstalar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <ShieldX className="h-12 w-12 mx-auto text-gray-400 mb-3" />
          <h2 className="text-lg font-semibold text-gray-700">Nenhum certificado instalado</h2>
          <p className="text-sm text-gray-500 mt-1 mb-4">
            Instale o certificado digital A1 (.pfx ou .p12) para emitir notas fiscais
          </p>
          <button type="button" onClick={() => { setShowUpload(true); setSelectedFile(null); setPassword('') }}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium">
            <Upload className="h-4 w-4" /> Instalar Certificado A1
          </button>
        </div>
      )}

      {/* Info card */}
      <div className="rounded-lg border bg-white p-5">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-blue-600" /> Sobre o Certificado Digital A1
        </h3>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">•</span>
            O certificado A1 é um arquivo digital (.pfx ou .p12) que identifica a empresa perante a Receita Federal e prefeituras.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">•</span>
            É obrigatório para emissão de NF-e (nota fiscal de produto) e NFS-e (nota fiscal de serviço).
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">•</span>
            Validade: geralmente 1 ano. Deve ser renovado antes do vencimento.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">•</span>
            O certificado é armazenado de forma segura no banco de dados e a senha é protegida.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-500 mt-0.5">⚠</span>
            Se você usa a <strong>Focus NFe</strong> como provedor fiscal, o certificado deve ser enviado também pelo painel da Focus NFe.
          </li>
        </ul>
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowUpload(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Upload className="h-5 w-5 text-blue-600" />
              {cert?.installed ? 'Substituir Certificado' : 'Instalar Certificado A1'}
            </h2>

            <div className="space-y-4">
              {/* File input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Arquivo do certificado (.pfx ou .p12) *</label>
                <input ref={fileRef} type="file" accept=".pfx,.p12" onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden" />
                {selectedFile ? (
                  <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-2">
                      <FileKey className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="text-sm font-medium text-blue-800">{selectedFile.name}</p>
                        <p className="text-xs text-blue-600">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = '' }}
                      className="text-blue-600 hover:text-blue-800 text-sm">Trocar</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-colors text-center">
                    <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600">Clique para selecionar o arquivo</p>
                    <p className="text-xs text-gray-400 mt-1">Formatos aceitos: .pfx, .p12 (máx. 50KB)</p>
                  </button>
                )}
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Senha do certificado *</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Senha fornecida pela certificadora"
                    className="w-full pl-10 pr-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200" />
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6 justify-end">
              <button type="button" onClick={() => setShowUpload(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleUpload} disabled={uploading || !selectedFile || !password}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {uploading ? 'Instalando...' : 'Instalar Certificado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDelete(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2 text-red-600">Desinstalar certificado?</h2>
            <p className="text-sm text-gray-600 mb-1">
              O certificado <strong>{cert?.filename}</strong> será removido permanentemente.
            </p>
            <p className="text-sm text-red-600 mb-4">
              A emissão de notas fiscais ficará indisponível até instalar um novo certificado.
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setShowDelete(false)}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Removendo...' : 'Desinstalar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
