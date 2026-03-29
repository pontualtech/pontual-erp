'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Category {
  id: string
  name: string
}

export default function EditarContaReceberPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])

  const [form, setForm] = useState({
    description: '',
    notes: '',
    total_amount: '',
    due_date: '',
    payment_method: '',
    category_id: '',
    status: '',
  })

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  useEffect(() => {
    Promise.all([
      fetch(`/api/financeiro/contas-receber/${id}`).then(r => r.json()),
      fetch('/api/financeiro/categorias?limit=100').then(r => r.json()),
    ]).then(([contaRes, catRes]) => {
      const c = contaRes.data
      if (!c) { toast.error('Conta nao encontrada'); router.push('/financeiro/contas-receber'); return }
      setForm({
        description: c.description || '',
        notes: c.notes || '',
        total_amount: String((c.total_amount || 0) / 100),
        due_date: c.due_date ? new Date(c.due_date).toISOString().split('T')[0] : '',
        payment_method: c.payment_method || '',
        category_id: c.category_id || '',
        status: c.status || 'PENDENTE',
      })
      setCategories(catRes.data ?? [])
    }).catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [id, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.description.trim()) { toast.error('Descricao e obrigatoria'); return }
    setSaving(true)
    try {
      const payload: any = {
        description: form.description,
        notes: form.notes || null,
        payment_method: form.payment_method || null,
        category_id: form.category_id || null,
      }
      if (form.total_amount) payload.total_amount = Math.round(parseFloat(form.total_amount) * 100)
      if (form.due_date) payload.due_date = form.due_date

      const res = await fetch(`/api/financeiro/contas-receber/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar')
      toast.success('Conta atualizada!')
      router.push(`/financeiro/contas-receber/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>

  const inp = 'w-full px-3 py-2 border rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-colors'

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/financeiro/contas-receber/${id}`} className="rounded-md border p-2 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Editar Conta a Receber</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descricao *</label>
            <input type="text" value={form.description} onChange={e => updateForm('description', e.target.value)}
              placeholder="Descricao da conta" className={inp} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
              <input type="number" step="0.01" min="0" value={form.total_amount}
                onChange={e => updateForm('total_amount', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vencimento</label>
              <input type="date" value={form.due_date}
                onChange={e => updateForm('due_date', e.target.value)} className={inp} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
              <select value={form.category_id} onChange={e => updateForm('category_id', e.target.value)} className={inp}>
                <option value="">Sem categoria</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Forma de Pagamento</label>
              <input type="text" value={form.payment_method}
                onChange={e => updateForm('payment_method', e.target.value)}
                placeholder="PIX, Boleto, etc." className={inp} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observacoes</label>
            <textarea value={form.notes} onChange={e => updateForm('notes', e.target.value)}
              rows={3} placeholder="Observacoes..." className={inp + ' resize-none'} />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={() => router.push(`/financeiro/contas-receber/${id}`)}
            className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Salvando...' : 'Salvar Alteracoes'}
          </button>
        </div>
      </form>
    </div>
  )
}
