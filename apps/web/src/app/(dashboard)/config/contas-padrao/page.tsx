'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Save, CreditCard, Banknote, Building2 } from 'lucide-react'

interface PaymentMethod { key: string; name: string; icon: string }
interface BankAccount { id: string; name: string }

export default function ContasPadraoPage() {
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [mappings, setMappings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [settingsRes, accountsRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/financeiro/contas-bancarias'),
      ])
      const settings = await settingsRes.json()
      const accs = await accountsRes.json()

      // Parse payment methods from settings
      const formas: PaymentMethod[] = []
      const defaults: Record<string, string> = {}
      const data = settings.data || {}

      // forma_pgto settings
      const formaPgto = data.forma_pgto || {}
      for (const [key, val] of Object.entries(formaPgto)) {
        try {
          const parsed = typeof val === 'string' ? JSON.parse(val) : (val as any).value ? JSON.parse((val as any).value) : val
          if (parsed.name && parsed.active !== false) {
            formas.push({ key: parsed.name, name: parsed.name, icon: parsed.icon || '💰' })
          }
        } catch {}
      }

      // account_default settings
      for (const [key, val] of Object.entries(data)) {
        if (key.startsWith('account_default.')) {
          const method = key.replace('account_default.', '')
          const value = typeof val === 'string' ? val : (val as any).value || ''
          defaults[method] = value
        }
      }
      // Also check nested
      const accDefaults = data.account_default || {}
      for (const [key, val] of Object.entries(accDefaults)) {
        const k = key.replace('account_default.', '')
        const value = typeof val === 'string' ? val : (val as any).value || ''
        defaults[k] = value
      }

      setMethods(formas.sort((a, b) => a.name.localeCompare(b.name)))
      setAccounts((accs.data || []).map((a: any) => ({ id: a.id, name: a.name })))
      setMappings(defaults)
    } catch (e) {
      toast.error('Erro ao carregar configuracoes')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const settings = Object.entries(mappings).map(([method, accountId]) => ({
        key: `account_default.${method}`,
        value: accountId,
        type: 'string',
      }))

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })

      if (res.ok) {
        toast.success('Contas padrao salvas com sucesso!')
      } else {
        toast.error('Erro ao salvar')
      }
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Carregando...</div>

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contas Padrao por Forma de Pagamento</h1>
          <p className="text-sm text-gray-500 mt-1">
            Defina qual conta bancaria recebe automaticamente para cada forma de pagamento
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 grid grid-cols-2 gap-4 text-sm font-medium text-gray-500">
          <div className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Forma de Pagamento</div>
          <div className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Conta Bancaria Padrao</div>
        </div>

        {methods.map(method => (
          <div key={method.key} className="px-4 py-3 border-b border-gray-100 grid grid-cols-2 gap-4 items-center hover:bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="text-lg">{method.icon}</span>
              <span className="text-sm font-medium text-gray-700">{method.name}</span>
            </div>
            <select
              value={mappings[method.name] || ''}
              onChange={e => setMappings(prev => ({ ...prev, [method.name]: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Nenhuma (manual)</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          </div>
        ))}

        {methods.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            Nenhuma forma de pagamento cadastrada. Configure em Formas de Pagamento.
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Salvando...' : 'Salvar Configuracoes'}
        </button>
      </div>

      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p className="text-sm text-amber-800">
          <strong>Como funciona:</strong> Quando uma OS e entregue e a forma de pagamento e selecionada,
          a conta a receber sera automaticamente vinculada a conta bancaria configurada aqui.
          Na baixa (recebimento), o valor sera creditado nesta conta.
        </p>
      </div>
    </div>
  )
}
