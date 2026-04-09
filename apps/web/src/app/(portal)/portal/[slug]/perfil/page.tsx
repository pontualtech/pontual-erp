'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

interface ProfileData {
  id: string
  legal_name: string
  email: string | null
  phone: string | null
  mobile: string | null
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_neighborhood: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  document_number: string | null
  person_type: string
}

export default function PerfilPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    email: '', phone: '', mobile: '',
    address_street: '', address_number: '', address_complement: '',
    address_neighborhood: '', address_city: '', address_state: '', address_zip: '',
  })

  useEffect(() => {
    fetch('/api/portal/profile')
      .then(r => { if (r.status === 401) { router.push(`/portal/${slug}/login`); return null }; return r.json() })
      .then(res => {
        if (res?.data) {
          setProfile(res.data)
          setForm({
            email: res.data.email || '',
            phone: res.data.phone || '',
            mobile: res.data.mobile || '',
            address_street: res.data.address_street || '',
            address_number: res.data.address_number || '',
            address_complement: res.data.address_complement || '',
            address_neighborhood: res.data.address_neighborhood || '',
            address_city: res.data.address_city || '',
            address_state: res.data.address_state || '',
            address_zip: res.data.address_zip || '',
          })
        }
      })
      .catch(() => toast.error('Erro ao carregar perfil'))
      .finally(() => setLoading(false))
  }, [slug, router])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/portal/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Erro ao salvar'); return }
      toast.success('Dados atualizados!')
    } catch { toast.error('Erro de conexao') }
    finally { setSaving(false) }
  }

  const inp = "w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
  const lbl = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"

  if (loading) return <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400" /></div>

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/portal/${slug}`} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">Meu Perfil</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Info card (read-only) */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <span className="text-xl font-bold text-blue-600 dark:text-blue-400">{profile?.legal_name?.charAt(0) || '?'}</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{profile?.legal_name}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {profile?.person_type === 'JURIDICA' ? 'CNPJ' : 'CPF'}: {profile?.document_number || '-'}
              </p>
            </div>
          </div>
        </div>

        {/* Editable form */}
        <form onSubmit={handleSave} className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 space-y-5">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Dados de Contato</h3>

          <div>
            <label className={lbl}>Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="seu@email.com" className={inp} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Telefone</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(11) 2626-3841" className={inp} />
            </div>
            <div>
              <label className={lbl}>Celular</label>
              <input type="tel" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} placeholder="(11) 9 1234-5678" className={inp} />
            </div>
          </div>

          <hr className="border-gray-200 dark:border-zinc-700" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Endereco</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className={lbl}>CEP</label>
              <input type="text" value={form.address_zip} onChange={e => setForm(f => ({ ...f, address_zip: e.target.value }))} placeholder="04128-001" maxLength={9} className={inp} />
            </div>
            <div>
              <label className={lbl}>Estado</label>
              <input type="text" value={form.address_state} onChange={e => setForm(f => ({ ...f, address_state: e.target.value }))} placeholder="SP" maxLength={2} className={inp} />
            </div>
          </div>

          <div>
            <label className={lbl}>Rua / Avenida</label>
            <input type="text" value={form.address_street} onChange={e => setForm(f => ({ ...f, address_street: e.target.value }))} className={inp} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Numero</label>
              <input type="text" value={form.address_number} onChange={e => setForm(f => ({ ...f, address_number: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Complemento</label>
              <input type="text" value={form.address_complement} onChange={e => setForm(f => ({ ...f, address_complement: e.target.value }))} className={inp} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Bairro</label>
              <input type="text" value={form.address_neighborhood} onChange={e => setForm(f => ({ ...f, address_neighborhood: e.target.value }))} className={inp} />
            </div>
            <div>
              <label className={lbl}>Cidade</label>
              <input type="text" value={form.address_city} onChange={e => setForm(f => ({ ...f, address_city: e.target.value }))} className={inp} />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" /> Salvando...</> : 'Salvar Alteracoes'}
          </button>

          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            Alteracoes serao notificadas a equipe da empresa.
          </p>
        </form>
      </main>
    </div>
  )
}
