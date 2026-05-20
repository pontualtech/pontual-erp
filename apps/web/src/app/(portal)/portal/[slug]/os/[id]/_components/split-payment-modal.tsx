'use client'

// Modal pra split de pagamento — Fase C-light 2026-05-20.
// Cliente preenche N formas (PIX, Boleto, Cartao), soma deve bater com total OS.
// Ao confirmar, chama POST /api/portal/payments/split que cria N AR + N charges Asaas.
// Apos sucesso, mostra os N pagamentos com QR/invoice URL pra cliente pagar cada um.

import { useState } from 'react'
import { toast } from 'sonner'
import { X, Plus, Trash2, Zap, FileText, Wallet, Loader2, ExternalLink, Copy, Check } from 'lucide-react'

type BillingMethod = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

interface SplitRow {
  method: BillingMethod | ''
  amount_str: string // valor BR (vírgula decimal)
  installments: number
}

interface SplitPayment {
  id: string
  receivable_id: string
  method: string
  amount: number
  status: string
  qr_code: string | null
  qr_code_image: string | null
  invoice_url: string | null
  bank_slip_url: string | null
  expires_at: string | null
  installments: number
  split_index: number
  split_total: number
}

function fmtBRL(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

const MIN_BY_METHOD: Record<BillingMethod, number> = {
  PIX: 100,
  BOLETO: 500,
  CREDIT_CARD: 500,
}

function methodIcon(m: BillingMethod) {
  if (m === 'PIX') return <Zap className="h-4 w-4 text-emerald-600" />
  if (m === 'BOLETO') return <FileText className="h-4 w-4 text-amber-600" />
  return <Wallet className="h-4 w-4 text-indigo-600" />
}

function methodLabel(m: string) {
  if (m === 'PIX') return 'PIX'
  if (m === 'BOLETO') return 'Boleto'
  if (m === 'CREDIT_CARD') return 'Cartão'
  return m
}

export default function SplitPaymentModal({ osId, totalCost, onClose }: {
  osId: string
  totalCost: number
  onClose: () => void
}) {
  const [splits, setSplits] = useState<SplitRow[]>([
    { method: '', amount_str: '', installments: 1 },
    { method: '', amount_str: '', installments: 1 },
  ])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SplitPayment[] | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  function parseAmount(str: string): number {
    // BR: "1.234,56" → 1234.56. Aceita só vírgula tambem.
    const cleaned = str.replace(/\./g, '').replace(',', '.')
    const n = parseFloat(cleaned)
    return isFinite(n) ? n : 0
  }

  const sumCents = splits.reduce((s, x) => s + Math.round(parseAmount(x.amount_str) * 100), 0)
  const diff = totalCost - sumCents

  function addRow() {
    setSplits([...splits, { method: '', amount_str: (Math.max(0, diff) / 100).toFixed(2).replace('.', ','), installments: 1 }])
  }
  function removeRow(idx: number) {
    if (splits.length <= 2) {
      toast.error('Split precisa de pelo menos 2 formas')
      return
    }
    setSplits(splits.filter((_, i) => i !== idx))
  }
  function updateRow(idx: number, patch: Partial<SplitRow>) {
    setSplits(splits.map((s, i) => i === idx ? { ...s, ...patch } : s))
  }

  async function submit() {
    // Validacao client-side antes de chamar API
    if (splits.length < 2) { toast.error('Adicione pelo menos 2 formas'); return }
    for (const s of splits) {
      if (!s.method) { toast.error('Selecione uma forma em cada linha'); return }
      const cents = Math.round(parseAmount(s.amount_str) * 100)
      if (cents <= 0) { toast.error('Valor inválido em alguma linha'); return }
      const min = MIN_BY_METHOD[s.method as BillingMethod]
      if (cents < min) {
        toast.error(`${methodLabel(s.method)} mínimo R$ ${(min / 100).toFixed(2)}`)
        return
      }
    }
    if (sumCents !== totalCost) {
      toast.error(`Soma (${fmtBRL(sumCents)}) precisa ser igual ao total (${fmtBRL(totalCost)})`)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/payments/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_order_id: osId,
          splits: splits.map(s => ({
            payment_method: s.method,
            amount_cents: Math.round(parseAmount(s.amount_str) * 100),
            ...(s.method === 'CREDIT_CARD' && s.installments > 1 ? { installments: s.installments } : {}),
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Erro ao gerar cobranças')
        return
      }
      setResult(data.data.payments)
      toast.success(`${data.data.payments.length} cobranças geradas!`)
    } catch {
      toast.error('Erro de rede')
    } finally {
      setSubmitting(false)
    }
  }

  function copyText(text: string, id: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-xl my-4 max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b dark:border-gray-700 bg-white dark:bg-gray-900">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {result ? 'Cobranças geradas' : 'Dividir pagamento'}
          </h2>
          <button type="button" onClick={onClose} title="Fechar"
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!result ? (
          <div className="p-4 space-y-4">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3 text-center">
              <p className="text-xs text-emerald-700 dark:text-emerald-400 uppercase tracking-wide font-semibold">Total da OS</p>
              <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-200">{fmtBRL(totalCost)}</p>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              Escolha como quer dividir. Ao confirmar, vamos gerar um link de pagamento separado pra cada forma.
            </p>

            <div className="space-y-2">
              {splits.map((s, idx) => (
                <div key={idx} className="rounded-xl border-2 border-gray-200 dark:border-gray-700 p-3 space-y-2 bg-gray-50 dark:bg-gray-800">
                  <div className="flex items-center gap-2">
                    <select
                      value={s.method}
                      onChange={e => updateRow(idx, { method: e.target.value as BillingMethod })}
                      title="Forma de pagamento"
                      className="flex-1 px-2 py-2 border rounded-lg text-sm bg-white dark:bg-gray-900 dark:border-gray-600"
                    >
                      <option value="">Escolha...</option>
                      <option value="PIX">⚡ PIX (instantâneo)</option>
                      <option value="BOLETO">📄 Boleto (vence amanhã)</option>
                      <option value="CREDIT_CARD">💳 Cartão</option>
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={s.amount_str}
                      onChange={e => updateRow(idx, { amount_str: e.target.value })}
                      placeholder="0,00"
                      title="Valor em reais"
                      className="w-28 px-2 py-2 border rounded-lg text-sm text-right bg-white dark:bg-gray-900 dark:border-gray-600"
                    />
                    {splits.length > 2 && (
                      <button type="button" onClick={() => removeRow(idx)} title="Remover forma"
                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {s.method === 'CREDIT_CARD' && (
                    <select
                      value={s.installments}
                      onChange={e => updateRow(idx, { installments: parseInt(e.target.value) || 1 })}
                      title="Parcelas"
                      className="w-full px-2 py-2 border rounded-lg text-sm bg-white dark:bg-gray-900 dark:border-gray-600"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n}x sem juros</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>

            <button type="button" onClick={addRow}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium">
              <Plus className="h-4 w-4" /> Adicionar outra forma
            </button>

            <div className={`rounded-xl p-3 text-sm font-medium ${
              diff === 0 ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900' :
              'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900'
            }`}>
              {diff === 0
                ? <span className="flex items-center gap-1"><Check className="h-4 w-4" /> Soma confere: {fmtBRL(totalCost)}</span>
                : diff > 0
                  ? `Faltam ${fmtBRL(diff)} (total: ${fmtBRL(totalCost)})`
                  : `Excedeu ${fmtBRL(-diff)} (total: ${fmtBRL(totalCost)})`}
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={onClose}
                className="px-4 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button type="button" onClick={submit} disabled={submitting || diff !== 0 || splits.some(s => !s.method)}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 dark:disabled:bg-emerald-900 text-white font-bold rounded-xl flex items-center justify-center gap-2">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</> : 'Gerar cobranças'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {result.length} cobranças prontas. Pague cada uma pelo link/QR Code abaixo:
            </p>

            {result.map((p, idx) => (
              <div key={p.id} className="rounded-xl border-2 border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {methodIcon(p.method as BillingMethod)}
                    <span className="font-bold text-sm text-gray-900 dark:text-gray-100">
                      {idx + 1}/{result.length} — {methodLabel(p.method)}
                      {p.method === 'CREDIT_CARD' && p.installments > 1 && ` ${p.installments}x`}
                    </span>
                  </div>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmtBRL(p.amount)}</span>
                </div>

                {p.method === 'PIX' && p.qr_code_image && (
                  <div className="text-center">
                    <img src={`data:image/png;base64,${p.qr_code_image}`} alt="QR Code PIX" className="w-40 h-40 mx-auto" />
                    {p.qr_code && (
                      <button type="button" onClick={() => copyText(p.qr_code!, p.id)}
                        className="text-xs flex items-center justify-center gap-1 mx-auto mt-2 text-blue-600 hover:text-blue-800">
                        {copied === p.id ? <><Check className="h-3 w-3" /> Copiado!</> : <><Copy className="h-3 w-3" /> Copiar PIX copia-e-cola</>}
                      </button>
                    )}
                  </div>
                )}

                {p.invoice_url && (
                  <a href={p.invoice_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 text-sm font-bold">
                    <ExternalLink className="h-4 w-4" /> Abrir link de pagamento
                  </a>
                )}

                {p.bank_slip_url && (
                  <a href={p.bank_slip_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full bg-amber-600 hover:bg-amber-700 text-white rounded-lg py-2.5 text-sm font-bold">
                    <FileText className="h-4 w-4" /> Baixar boleto
                  </a>
                )}
              </div>
            ))}

            <button type="button" onClick={onClose}
              className="w-full py-3 border-2 border-gray-300 dark:border-gray-600 rounded-xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800">
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
