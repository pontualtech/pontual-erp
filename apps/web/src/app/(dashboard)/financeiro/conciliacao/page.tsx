'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, XCircle, Plus,
  Clock, ArrowRightLeft, AlertTriangle, RefreshCw, Eye, ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BankAccount {
  id: string
  name: string
  bank_name: string | null
  agency: string | null
  account_number: string | null
}

interface SuggestedMatch {
  type: 'payable' | 'receivable'
  id: string
  description: string
  total_amount: number
  due_date: string
  customer_name: string | null
  status: string | null
}

interface Transaction {
  id: string
  account_id: string
  transaction_type: string
  amount: number
  description: string | null
  bank_ref: string | null
  reconciled: boolean
  transaction_date: string
  created_at: string
  suggested_match: SuggestedMatch | null
}

interface Summary {
  total: number
  with_match: number
  without_match: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConciliacaoPage() {
  // State: accounts
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  // State: upload
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{ total: number; imported: number; skipped: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // State: transactions
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loadingTransactions, setLoadingTransactions] = useState(false)

  // State: reconciliation actions
  const [reconcilingId, setReconcilingId] = useState<string | null>(null)
  const [ignoringId, setIgnoringId] = useState<string | null>(null)

  // State: reconciled count (for summary bar)
  const [reconciledCount, setReconciledCount] = useState(0)

  // Load bank accounts on mount
  useEffect(() => {
    fetch('/api/financeiro/contas-bancarias?limit=50')
      .then(r => r.json())
      .then(d => {
        const accs = d.data ?? []
        setAccounts(accs)
        if (accs.length === 1) setSelectedAccountId(accs[0].id)
      })
      .catch(() => toast.error('Erro ao carregar contas bancarias'))
      .finally(() => setLoadingAccounts(false))
  }, [])

  // Load pending transactions when account changes
  const loadPendentes = useCallback(() => {
    if (!selectedAccountId) {
      setTransactions([])
      setSummary(null)
      return
    }
    setLoadingTransactions(true)
    fetch(`/api/financeiro/conciliacao/pendentes?account_id=${selectedAccountId}`)
      .then(r => r.json())
      .then(d => {
        setTransactions(d.data?.transactions ?? [])
        setSummary(d.data?.summary ?? null)
        setReconciledCount(0)
        setUploadResult(null)
      })
      .catch(() => toast.error('Erro ao carregar transacoes'))
      .finally(() => setLoadingTransactions(false))
  }, [selectedAccountId])

  useEffect(() => { loadPendentes() }, [loadPendentes])

  // Upload OFX file
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!selectedAccountId) {
      toast.error('Selecione uma conta bancaria primeiro')
      return
    }

    setUploading(true)
    setUploadResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('account_id', selectedAccountId)

      const res = await fetch('/api/financeiro/conciliacao/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao importar arquivo')

      setUploadResult(data.data)
      toast.success(`${data.data.imported} transacao(es) importada(s)`)

      // Reload pending transactions
      loadPendentes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar arquivo')
    } finally {
      setUploading(false)
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Reconcile a transaction with its suggested match
  async function handleReconcile(transaction: Transaction) {
    if (!transaction.suggested_match) return
    setReconcilingId(transaction.id)
    try {
      const res = await fetch('/api/financeiro/conciliacao/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transaction.id,
          type: transaction.suggested_match.type,
          record_id: transaction.suggested_match.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao conciliar')

      toast.success('Transacao conciliada com sucesso')
      setTransactions(prev => prev.filter(t => t.id !== transaction.id))
      setReconciledCount(prev => prev + 1)
      if (summary) {
        setSummary({
          ...summary,
          total: summary.total - 1,
          with_match: summary.with_match - 1,
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao conciliar')
    } finally {
      setReconcilingId(null)
    }
  }

  // Ignore a transaction (mark as reconciled without linking to any record)
  async function handleIgnore(transactionId: string) {
    setIgnoringId(transactionId)
    try {
      const res = await fetch('/api/financeiro/conciliacao/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          type: 'ignore',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao ignorar')

      toast.success('Transacao ignorada')
      const txn = transactions.find(t => t.id === transactionId)
      setTransactions(prev => prev.filter(t => t.id !== transactionId))
      setReconciledCount(prev => prev + 1)
      if (summary) {
        setSummary({
          ...summary,
          total: summary.total - 1,
          with_match: txn?.suggested_match ? summary.with_match - 1 : summary.with_match,
          without_match: txn?.suggested_match ? summary.without_match : summary.without_match - 1,
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao ignorar transacao')
    } finally {
      setIgnoringId(null)
    }
  }

  // Computed summary values
  const totalVisible = transactions.length
  const withMatch = transactions.filter(t => t.suggested_match).length
  const withoutMatch = totalVisible - withMatch

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/financeiro"
            className="rounded-md p-1.5 hover:bg-gray-100 text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Conciliacao Bancaria</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Importe o extrato OFX e concilie com lancamentos do sistema
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: Account Selection + Upload */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">
          1. Selecione a conta e importe o extrato
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[250px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Conta Bancaria
            </label>
            {loadingAccounts ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                <Clock className="h-4 w-4 animate-spin" /> Carregando contas...
              </div>
            ) : accounts.length === 0 ? (
              <div className="text-sm text-gray-500 py-2">
                Nenhuma conta bancaria cadastrada.{' '}
                <Link href="/financeiro/contas-bancarias" className="text-blue-600 hover:underline">
                  Cadastrar
                </Link>
              </div>
            ) : (
              <div className="relative">
                <select
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  className="w-full rounded-md border bg-white py-2.5 px-3 pr-8 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 appearance-none"
                >
                  <option value="">Selecione uma conta...</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                      {acc.bank_name ? ` - ${acc.bank_name}` : ''}
                      {acc.agency ? ` Ag ${acc.agency}` : ''}
                      {acc.account_number ? ` CC ${acc.account_number}` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ofx,.ofc"
              onChange={handleUpload}
              className="hidden"
              id="ofx-upload"
            />
            <label
              htmlFor="ofx-upload"
              className={cn(
                'flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium cursor-pointer transition-colors',
                selectedAccountId && !uploading
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              )}
              onClick={e => {
                if (!selectedAccountId || uploading) e.preventDefault()
              }}
            >
              {uploading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> Importando...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" /> Importar OFX
                </>
              )}
            </label>
          </div>

          {selectedAccountId && (
            <button
              onClick={loadPendentes}
              disabled={loadingTransactions}
              className="flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={cn('h-4 w-4', loadingTransactions && 'animate-spin')} />
              Atualizar
            </button>
          )}
        </div>

        {/* Upload result feedback */}
        {uploadResult && (
          <div className="mt-4 rounded-md bg-blue-50 border border-blue-200 p-3">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              <FileSpreadsheet className="h-4 w-4" />
              <span>
                <strong>{uploadResult.imported}</strong> transacao(es) importada(s)
                {uploadResult.skipped > 0 && (
                  <>, <strong>{uploadResult.skipped}</strong> ja existente(s) (ignoradas)</>
                )}
                {' '}de <strong>{uploadResult.total}</strong> no arquivo.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Summary Bar */}
      {selectedAccountId && summary && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-blue-50 p-2">
                <FileSpreadsheet className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Pendentes</p>
                <p className="text-xl font-bold text-gray-900">{totalVisible}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-50 p-2">
                <ArrowRightLeft className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Com Sugestao</p>
                <p className="text-xl font-bold text-green-600">{withMatch}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-50 p-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Sem Match</p>
                <p className="text-xl font-bold text-amber-600">{withoutMatch}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-emerald-50 p-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Conciliadas</p>
                <p className="text-xl font-bold text-emerald-600">{reconciledCount}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Transactions List */}
      {selectedAccountId && (
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
          <div className="border-b px-5 py-3 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              2. Transacoes Pendentes de Conciliacao
            </h2>
            {totalVisible > 0 && (
              <span className="text-xs text-gray-400">
                {totalVisible} transacao(es)
              </span>
            )}
          </div>

          {loadingTransactions ? (
            <div className="px-5 py-10 text-center">
              <Clock className="h-6 w-6 text-gray-300 animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-400">Carregando transacoes...</p>
            </div>
          ) : transactions.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {uploadResult
                  ? 'Todas as transacoes ja foram conciliadas!'
                  : 'Nenhuma transacao pendente. Importe um arquivo OFX para comecar.'}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {transactions.map(txn => {
                const isDebit = txn.transaction_type === 'DEBIT'
                const isReconciling = reconcilingId === txn.id
                const isIgnoring = ignoringId === txn.id

                return (
                  <div
                    key={txn.id}
                    className="px-5 py-4 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Transaction info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                            isDebit
                              ? 'bg-red-100 text-red-700'
                              : 'bg-green-100 text-green-700'
                          )}>
                            {isDebit ? 'Debito' : 'Credito'}
                          </span>
                          <span className="text-xs text-gray-400">
                            {formatDate(txn.transaction_date)}
                          </span>
                          {txn.bank_ref && (
                            <span className="text-xs text-gray-300" title="FITID">
                              #{txn.bank_ref.slice(-8)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {txn.description || 'Sem descricao'}
                        </p>
                        <p className={cn(
                          'text-lg font-bold mt-0.5',
                          isDebit ? 'text-red-600' : 'text-green-600'
                        )}>
                          {isDebit ? '- ' : '+ '}{formatCurrency(txn.amount)}
                        </p>
                      </div>

                      {/* Suggested match */}
                      <div className="flex-1 min-w-0">
                        {txn.suggested_match ? (
                          <div className="rounded-md border border-green-200 bg-green-50/50 p-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <ArrowRightLeft className="h-3.5 w-3.5 text-green-600" />
                              <span className="text-xs font-medium text-green-700">
                                Sugestao: {txn.suggested_match.type === 'payable' ? 'Conta a Pagar' : 'Conta a Receber'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 truncate">
                              {txn.suggested_match.description}
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                              <span>{formatCurrency(txn.suggested_match.total_amount)}</span>
                              <span>Venc: {formatDate(txn.suggested_match.due_date)}</span>
                              {txn.suggested_match.customer_name && (
                                <span className="truncate">{txn.suggested_match.customer_name}</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                            <div className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              <span className="text-xs text-gray-500">
                                Nenhum lancamento correspondente encontrado
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {txn.suggested_match && (
                          <button
                            onClick={() => handleReconcile(txn)}
                            disabled={isReconciling}
                            className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            {isReconciling ? (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            Conciliar
                          </button>
                        )}
                        <button
                          onClick={() => handleIgnore(txn.id)}
                          disabled={isIgnoring}
                          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                          {isIgnoring ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          Ignorar
                        </button>
                        <Link
                          href={
                            txn.transaction_type === 'DEBIT'
                              ? '/financeiro/contas-pagar/novo'
                              : '/financeiro/contas-receber/novo'
                          }
                          className="flex items-center gap-1.5 rounded-md border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Criar Lancamento
                        </Link>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state when no account selected */}
      {!selectedAccountId && !loadingAccounts && accounts.length > 0 && (
        <div className="rounded-lg border bg-white p-10 text-center shadow-sm">
          <FileSpreadsheet className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            Selecione uma conta bancaria acima para iniciar a conciliacao
          </p>
        </div>
      )}
    </div>
  )
}
