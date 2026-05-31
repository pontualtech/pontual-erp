'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

// Split payment 2026-05-19: cada linha = uma forma de pagamento dentro do payable
interface Split {
  payment_method: string
  account_id: string
  amount_str: string
  installment_count: string
}
const emptySplit = (): Split => ({ payment_method: '', account_id: '', amount_str: '', installment_count: '1' })

interface SearchResult {
  // Wave SU-1 (2026-05-27): agora reflete Supplier (campo `name`), não Customer (`legal_name`)
  id: string
  name: string
}

interface Category {
  id: string
  name: string
}

interface CostCenter {
  id: string
  name: string
}

interface BankAccount {
  id: string
  name: string
  bank_name?: string | null
}

export default function NovaContaPagarPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Supplier search
  const [supplierSearch, setSupplierSearch] = useState('')
  const [suppliers, setSuppliers] = useState<SearchResult[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<SearchResult | null>(null)

  // Selects data
  const [categories, setCategories] = useState<Category[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])

  const [form, setForm] = useState({
    supplier_id: '',
    description: '',
    notes: '',
    total_amount: '',
    due_date: '',
    category_id: '',
    cost_center_id: '',
  })

  const [splits, setSplits] = useState<Split[]>([emptySplit()])

  function updateForm(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }
  function updateSplit(idx: number, field: keyof Split, value: string) {
    setSplits(prev => prev.map((sp, i) => i === idx ? { ...sp, [field]: value } : sp))
  }
  function addSplit() { setSplits(prev => [...prev, emptySplit()]) }
  function removeSplit(idx: number) { setSplits(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev) }

  const isSingleSplit = splits.length === 1
  const splitsSum = splits.reduce((s, sp) => s + (Number(sp.amount_str.replace(',', '.')) || 0), 0)
  const totalNum = Number(form.total_amount.replace(',', '.')) || 0
  const sumValid = isSingleSplit ? true : Math.abs(splitsSum - totalNum) < 0.005
  const sumDiff = totalNum - splitsSum

  // Load categories, cost centers, bank accounts
  useEffect(() => {
    fetch('/api/financeiro/categorias?limit=100')
      .then(r => r.json())
      .then(d => setCategories(d.data ?? []))
      .catch(() => {})

    fetch('/api/financeiro/centros-custo?limit=100')
      .then(r => r.json())
      .then(d => setCostCenters(d.data ?? []))
      .catch(() => {})

    fetch('/api/financeiro/contas-bancarias')
      .then(r => r.json())
      .then(d => {
        const accs = d.data ?? []
        setBankAccounts(accs)
        // Default: Itaú como conta padrão (Karlão 31/05). Busca por name contendo
        // "ITAU" case-insensitive; fallback pra primeira conta ativa.
        const defaultAcc = accs.find((a: any) => /itau/i.test(a.name)) ?? accs[0]
        if (defaultAcc?.id) {
          setSplits(prev => prev.map((sp, i) => i === 0 && !sp.account_id ? { ...sp, account_id: defaultAcc.id } : sp))
        }
      })
      .catch(() => {})
  }, [])

  // Wave SU-1 fix I3 (2026-05-27): debounce 300ms — evita flood de fetches enquanto user digita.
  // Antes: cada tecla = 1 request. Agora: aguarda usuário pausar antes de buscar.
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function searchSuppliers(query: string) {
    setSupplierSearch(query)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (query.length < 2) { setSuppliers([]); return }
    searchTimerRef.current = setTimeout(async () => {
      try {
        // Wave SU-1: busca em /api/suppliers (era /api/clientes — anti-pattern legado)
        const res = await fetch(`/api/suppliers?search=${encodeURIComponent(query)}&limit=5&active=true`)
        const json = await res.json()
        setSuppliers(json.data || [])
      } catch { setSuppliers([]) }
    }, 300)
  }

  function selectSupplier(supplier: SearchResult) {
    setSelectedSupplier(supplier)
    setSupplierSearch(supplier.name)
    setSuppliers([])
    updateForm('supplier_id', supplier.id)
  }

  // Wave SU-1: modal pra criar fornecedor inline (sem sair da tela)
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState('')
  const [newSupplierDoc, setNewSupplierDoc] = useState('')
  const [newSupplierPhone, setNewSupplierPhone] = useState('')
  const [creatingSupplier, setCreatingSupplier] = useState(false)

  // Wave SU-1 fix I4 (2026-05-27): fecha modal + limpa inputs (antes mantinha valores entre aberturas)
  function closeNewSupplierModal() {
    setShowNewSupplier(false)
    setNewSupplierName('')
    setNewSupplierDoc('')
    setNewSupplierPhone('')
  }

  async function createSupplierInline() {
    if (!newSupplierName.trim()) { toast.error('Nome do fornecedor é obrigatório'); return }
    setCreatingSupplier(true)
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSupplierName.trim(),
          document: newSupplierDoc.trim() || undefined,
          phone: newSupplierPhone.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error || 'Erro ao cadastrar fornecedor'); return }
      const created = json.data
      // Autoseleciona o recém-criado
      const sel: SearchResult = { id: created.id, name: created.name }
      selectSupplier(sel)
      setShowNewSupplier(false)
      setNewSupplierName(''); setNewSupplierDoc(''); setNewSupplierPhone('')
      toast.success(`Fornecedor "${created.name}" cadastrado`)
    } catch { toast.error('Erro de conexão') }
    finally { setCreatingSupplier(false) }
  }

  function clearSupplier() {
    setSelectedSupplier(null)
    setSupplierSearch('')
    updateForm('supplier_id', '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.description) { toast.error('Descricao e obrigatoria'); return }
    if (!form.total_amount || Number(form.total_amount.replace(',', '.')) <= 0) { toast.error('Valor deve ser maior que zero'); return }
    if (!form.due_date) { toast.error('Data de vencimento e obrigatoria'); return }
    if (!sumValid) { toast.error(`Soma das formas (R$ ${splitsSum.toFixed(2)}) deve ser igual ao total (R$ ${totalNum.toFixed(2)})`); return }
    // Conta bancária obrigatória em TODOS os splits (Karlão 31/05).
    const missingAccount = splits.findIndex(sp => !sp.account_id)
    if (missingAccount >= 0) {
      toast.error(splits.length > 1 ? `Forma ${missingAccount + 1}: selecione a conta bancária` : 'Selecione a conta bancária')
      return
    }

    setLoading(true)
    try {
      const amountInCents = Math.round(totalNum * 100)
      const splitsPayload = splits.map(sp => ({
        payment_method: sp.payment_method || undefined,
        account_id: sp.account_id || undefined,
        amount: Math.round((Number(sp.amount_str.replace(',', '.')) || (isSingleSplit ? totalNum : 0)) * 100),
        installment_count: Number(sp.installment_count) > 1 ? Number(sp.installment_count) : undefined,
      }))
      const sumCents = splitsPayload.reduce((s, x) => s + x.amount, 0)
      if (sumCents !== amountInCents) {
        if (isSingleSplit) splitsPayload[0].amount = amountInCents
        else { toast.error(`Soma exata em centavos diverge`); setLoading(false); return }
      }

      const body: any = {
        description: form.description,
        total_amount: amountInCents,
        due_date: form.due_date,
        supplier_id: form.supplier_id || undefined,
        category_id: form.category_id || undefined,
        cost_center_id: form.cost_center_id || undefined,
        notes: form.notes || undefined,
      }
      if (splits.length > 1) {
        body.splits = splitsPayload
      } else {
        body.payment_method = splits[0].payment_method || undefined
        body.account_id = splits[0].account_id || undefined
        body.installment_count = Number(splits[0].installment_count) > 1 ? Number(splits[0].installment_count) : undefined
      }

      const res = await fetch('/api/financeiro/contas-pagar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar')

      toast.success(splits.length > 1 ? `${splits.length} contas a pagar cadastradas (grupo)!` : 'Conta a pagar cadastrada!')
      router.push('/financeiro/contas-pagar')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cadastrar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/financeiro/contas-pagar"
          className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nova Conta a Pagar</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <Link href="/financeiro" className="text-blue-600 hover:underline">Financeiro</Link>
            {' / '}
            <Link href="/financeiro/contas-pagar" className="text-blue-600 hover:underline">Contas a Pagar</Link>
            {' / Novo'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Fornecedor */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Fornecedor</h2>
          <div className="relative">
            <label htmlFor="supplier-search" className="block text-sm text-gray-600 mb-1">Buscar fornecedor (opcional)</label>
            <input
              id="supplier-search"
              type="text"
              value={supplierSearch}
              onChange={e => searchSuppliers(e.target.value)}
              placeholder="Digite o nome do fornecedor..."
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
            {suppliers.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-40 overflow-y-auto">
                {suppliers.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectSupplier(s)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {selectedSupplier && (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-green-600">Selecionado: {selectedSupplier.name}</p>
                <button type="button" onClick={clearSupplier} className="text-xs text-red-500 hover:underline">Remover</button>
              </div>
            )}
            {/* Wave SU-1: botão pra criar fornecedor inline (sem ir em /estoque/fornecedores) */}
            {!selectedSupplier && (
              <button
                type="button"
                onClick={() => { setShowNewSupplier(true); setNewSupplierName(supplierSearch); }}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                <Plus className="w-3 h-3" /> Novo fornecedor
              </button>
            )}
          </div>

          {/* Modal cadastro inline de Fornecedor */}
          {showNewSupplier && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-900">Novo Fornecedor</h3>
                  <button type="button" onClick={closeNewSupplierModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1" htmlFor="new-sup-name">Nome / Razão social *</label>
                  <input
                    id="new-sup-name"
                    type="text"
                    value={newSupplierName}
                    onChange={e => setNewSupplierName(e.target.value)}
                    autoFocus
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="Ex: Distribuidora ACME LTDA"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1" htmlFor="new-sup-doc">CNPJ / CPF (opcional)</label>
                  <input
                    id="new-sup-doc"
                    type="text"
                    value={newSupplierDoc}
                    onChange={e => setNewSupplierDoc(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="00.000.000/0000-00"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1" htmlFor="new-sup-phone">Telefone (opcional)</label>
                  <input
                    id="new-sup-phone"
                    type="text"
                    value={newSupplierPhone}
                    onChange={e => setNewSupplierPhone(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="(11) 99999-9999"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeNewSupplierModal}
                    className="flex-1 px-3 py-2 border rounded-md text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={createSupplierInline}
                    disabled={creatingSupplier || !newSupplierName.trim()}
                    className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium disabled:opacity-50"
                  >
                    {creatingSupplier ? 'Salvando...' : 'Cadastrar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Detalhes */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Detalhes</h2>
          <div>
            <label htmlFor="description" className="block text-sm text-gray-600 mb-1">Descricao *</label>
            <input
              id="description"
              type="text"
              value={form.description}
              onChange={e => updateForm('description', e.target.value)}
              placeholder="Ex: Aluguel escritorio, compra de material..."
              required
              className="w-full px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="total_amount" className="block text-sm text-gray-600 mb-1">Valor (R$) *</label>
              <input
                id="total_amount"
                type="number"
                step="0.01"
                min="0.01"
                value={form.total_amount}
                onChange={e => updateForm('total_amount', e.target.value)}
                placeholder="0,00"
                required
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
            <div>
              <label htmlFor="due_date" className="block text-sm text-gray-600 mb-1">Vencimento *</label>
              <input
                id="due_date"
                type="date"
                value={form.due_date}
                onChange={e => updateForm('due_date', e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-md text-sm"
              />
            </div>
          </div>
        </div>

        {/* Formas de Pagamento (split) */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Formas de Pagamento</h2>
            <button
              type="button"
              onClick={addSplit}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar forma
            </button>
          </div>

          {splits.map((sp, idx) => {
            const showHeader = splits.length > 1
            const displayAmount = isSingleSplit && totalNum > 0 ? totalNum.toFixed(2).replace('.', ',') : sp.amount_str
            return (
              <div key={idx} className={`${showHeader ? 'border rounded-lg p-3 space-y-2 bg-gray-50' : 'space-y-2'}`}>
                {showHeader && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">Forma {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeSplit(idx)}
                      className="text-gray-400 hover:text-red-600 cursor-pointer"
                      title="Remover esta forma"
                      aria-label={`Remover forma ${idx + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Forma</label>
                    <select
                      aria-label={`Forma de pagamento ${idx + 1}`}
                      value={sp.payment_method}
                      onChange={e => updateSplit(idx, 'payment_method', e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                    >
                      <option value="">Selecione...</option>
                      <option value="DINHEIRO">Dinheiro</option>
                      <option value="PIX">Pix</option>
                      <option value="CARTAO_CREDITO">Cartao de Credito</option>
                      <option value="CARTAO_DEBITO">Cartao de Debito</option>
                      <option value="BOLETO">Boleto</option>
                      <option value="TRANSFERENCIA">Transferencia</option>
                      <option value="CHEQUE">Cheque</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Parcelas</label>
                    <select
                      aria-label={`Parcelas da forma ${idx + 1}`}
                      value={sp.installment_count}
                      onChange={e => updateSplit(idx, 'installment_count', e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={String(n)}>{n}x</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Banco origem</label>
                    <select
                      aria-label={`Banco origem da forma ${idx + 1}`}
                      value={sp.account_id}
                      onChange={e => updateSplit(idx, 'account_id', e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                    >
                      <option value="">Nenhum (definir na baixa)</option>
                      {bankAccounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}{acc.bank_name ? ` — ${acc.bank_name}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {showHeader && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Valor desta forma (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={displayAmount}
                        onChange={e => updateSplit(idx, 'amount_str', e.target.value)}
                        placeholder="0,00"
                        className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {splits.length > 1 && (
            <div className={`rounded-md border p-2.5 text-xs flex items-center justify-between ${sumValid ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              <span>Soma das formas:</span>
              <span className="font-bold">
                R$ {splitsSum.toFixed(2)} / R$ {totalNum.toFixed(2)}
                {!sumValid && sumDiff !== 0 && <span className="ml-2 font-normal">(falta R$ {sumDiff.toFixed(2)})</span>}
                {sumValid && ' ✓'}
              </span>
            </div>
          )}
        </div>

        {/* Classificacao */}
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Classificacao</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="category_id" className="block text-sm text-gray-600 mb-1">Categoria</label>
              <select
                id="category_id"
                value={form.category_id}
                onChange={e => updateForm('category_id', e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm"
              >
                <option value="">Selecione...</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cost_center_id" className="block text-sm text-gray-600 mb-1">Centro de Custo</label>
              <select
                id="cost_center_id"
                value={form.cost_center_id}
                onChange={e => updateForm('cost_center_id', e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm"
              >
                <option value="">Selecione...</option>
                {costCenters.map(cc => (
                  <option key={cc.id} value={cc.id}>{cc.name}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Conta bancária origem agora é definida em cada forma de pagamento (acima).
          </p>
        </div>

        {/* Observacoes */}
        <div className="rounded-lg border bg-white p-5">
          <label htmlFor="notes" className="block text-sm text-gray-600 mb-1">Observacoes</label>
          <textarea
            id="notes"
            value={form.notes}
            onChange={e => updateForm('notes', e.target.value)}
            rows={2}
            placeholder="Informacoes adicionais..."
            className="w-full px-3 py-2 border rounded-md resize-none text-sm"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50 text-sm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
          >
            {loading ? 'Salvando...' : 'Cadastrar Conta a Pagar'}
          </button>
        </div>
      </form>
    </div>
  )
}
