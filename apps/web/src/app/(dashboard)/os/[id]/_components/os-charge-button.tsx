'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CreditCard, Loader2, X, Copy, ExternalLink, Check } from 'lucide-react'

type Account = {
  id: string
  name: string
  bank_name: string | null
  provider: string
}

type ChargeHistoryItem = {
  id: string
  provider: string
  method: string
  billing_type: string | null
  amount: number
  status: string
  invoice_url: string | null
  bank_slip_url: string | null
  paid_at: string | null
  created_at: string
  account: { id: string; name: string; bank_name: string | null } | null
}

function fmtBRL(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/**
 * Botao + Modal + Historico de cobrancas da OS.
 * Permite atendente (com permissao os:charge) enviar link de pagamento
 * sem precisar ter acesso ao modulo financeiro completo.
 */
export default function OsChargeButton({ osId, osNumber, totalCost }: {
  osId: string
  osNumber: number
  totalCost: number
}) {
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [history, setHistory] = useState<ChargeHistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Form state
  const [accountId, setAccountId] = useState<string>('')
  const [billingType, setBillingType] = useState<'PIX' | 'BOLETO' | 'CREDIT_CARD'>('BOLETO')
  const [dueDays, setDueDays] = useState(7)
  const [installments, setInstallments] = useState(1)
  const [sendWhats, setSendWhats] = useState(true)
  const [sendEmail, setSendEmail] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ invoice_url: string; billing_type: string } | null>(null)

  // Load accounts + history on open
  useEffect(() => {
    if (!open) return
    setLoadingAccounts(true)
    fetch('/api/os/charge-accounts')
      .then(r => r.json())
      .then(d => {
        const list = d.data || []
        setAccounts(list)
        if (list.length > 0 && !accountId) setAccountId(list[0].id)
      })
      .catch(() => toast.error('Falha ao carregar contas'))
      .finally(() => setLoadingAccounts(false))

    setLoadingHistory(true)
    fetch(`/api/os/${osId}/charge`)
      .then(r => r.json())
      .then(d => setHistory(d.data || []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, osId])

  async function handleSubmit() {
    if (!accountId) return toast.error('Selecione uma conta')
    if (totalCost <= 0) return toast.error('OS sem valor — defina orcamento antes')

    setSubmitting(true)
    try {
      const res = await fetch(`/api/os/${osId}/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          billing_type: billingType,
          due_days: billingType === 'BOLETO' ? dueDays : undefined,
          installment_count: billingType === 'CREDIT_CARD' ? installments : undefined,
          send_whatsapp: sendWhats,
          send_email: sendEmail,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Falha ao criar cobranca')
        return
      }
      toast.success(`Cobranca enviada${data.sent_whatsapp ? ' via WhatsApp' : ''}${data.sent_email ? ' + Email' : ''}`)
      setResult({ invoice_url: data.payment.invoice_url, billing_type: data.payment.billing_type })
      // Reload historico
      fetch(`/api/os/${osId}/charge`).then(r => r.json()).then(d => setHistory(d.data || [])).catch(() => {})
    } catch {
      toast.error('Erro de rede')
    } finally {
      setSubmitting(false)
    }
  }

  function copyLink(url: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => toast.success('Link copiado'))
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
        title="Enviar cobranca via PIX, boleto ou cartao">
        <CreditCard className="h-4 w-4" /> Cobrar
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 overflow-y-auto"
          onClick={() => !submitting && setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl my-4 max-h-[95vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                Cobrar OS #{osNumber}
              </h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar"
                className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            </div>

            {result ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-800 flex items-center gap-2">
                    <Check className="h-5 w-5" /> Cobranca criada com sucesso
                  </p>
                  <p className="text-xs text-emerald-700 mt-1">
                    Tipo: <strong>{result.billing_type}</strong>
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-600">Link de pagamento</label>
                  <div className="flex gap-2">
                    <input type="text" readOnly value={result.invoice_url}
                      aria-label="Link de pagamento"
                      className="flex-1 rounded-lg border px-3 py-2 text-xs bg-gray-50 font-mono" />
                    <button type="button" onClick={() => copyLink(result.invoice_url)}
                      className="px-3 py-2 bg-gray-700 text-white rounded-lg text-xs font-medium" title="Copiar link">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <a href={result.invoice_url} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium" title="Abrir">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
                <button type="button" onClick={() => { setResult(null); setOpen(false) }}
                  className="w-full rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  Fechar
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label htmlFor="charge-account" className="block text-xs font-medium text-gray-700 mb-1">
                    Conta bancaria *
                  </label>
                  {loadingAccounts ? (
                    <div className="text-xs text-gray-400"><Loader2 className="inline h-3 w-3 animate-spin" /> Carregando...</div>
                  ) : accounts.length === 0 ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                      Nenhuma conta bancaria configurada. Peca ao administrador pra adicionar em Configurações → Contas Bancárias.
                    </div>
                  ) : (
                    <select id="charge-account" value={accountId}
                      onChange={e => setAccountId(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-sm">
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.name}{a.bank_name ? ` — ${a.bank_name}` : ''} ({a.provider})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Forma de pagamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['PIX', 'BOLETO', 'CREDIT_CARD'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setBillingType(t)}
                        className={`py-2 rounded-lg border-2 text-sm font-medium ${
                          billingType === t ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'
                        }`}>
                        {t === 'PIX' ? 'PIX' : t === 'BOLETO' ? 'Boleto' : 'Cartão'}
                      </button>
                    ))}
                  </div>
                </div>

                {billingType === 'BOLETO' && (
                  <div>
                    <label htmlFor="charge-due" className="block text-xs font-medium text-gray-700 mb-1">
                      Vencimento (dias)
                    </label>
                    <input id="charge-due" type="number" min={1} max={90} value={dueDays}
                      onChange={e => setDueDays(Math.max(1, Math.min(90, parseInt(e.target.value || '7', 10))))}
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      aria-label="Dias ate vencimento do boleto" />
                    <p className="text-[10px] text-gray-400 mt-1">Cliente pagara em {dueDays} dia{dueDays === 1 ? '' : 's'}.</p>
                  </div>
                )}

                {billingType === 'CREDIT_CARD' && (
                  <div>
                    <label htmlFor="charge-inst" className="block text-xs font-medium text-gray-700 mb-1">Parcelas</label>
                    <select id="charge-inst" value={installments}
                      onChange={e => setInstallments(parseInt(e.target.value, 10))}
                      className="w-full rounded-lg border px-3 py-2 text-sm">
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                        <option key={n} value={n}>{n}x de {fmtBRL(Math.round(totalCost / n))}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Enviar para o cliente via</label>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={sendWhats} onChange={e => setSendWhats(e.target.checked)} />
                      WhatsApp
                    </label>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} />
                      E-mail
                    </label>
                  </div>
                </div>

                <div className="rounded-lg bg-gray-50 p-3 text-sm">
                  <span className="text-gray-600">Valor:</span>{' '}
                  <strong className="text-gray-900">{fmtBRL(totalCost)}</strong>
                </div>

                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)}
                    className="flex-1 rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                    Cancelar
                  </button>
                  <button type="button" onClick={handleSubmit}
                    disabled={submitting || !accountId || accounts.length === 0 || totalCost <= 0}
                    className="flex-1 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                    Enviar cobranca
                  </button>
                </div>

                {/* Histórico */}
                {history.length > 0 && (
                  <div className="pt-4 border-t">
                    <h4 className="text-xs font-semibold text-gray-700 mb-2">Cobrancas ja enviadas ({history.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {history.map(h => (
                        <div key={h.id} className="flex items-center justify-between gap-2 text-xs bg-gray-50 rounded p-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded font-semibold ${
                                h.status === 'CONFIRMED' || h.status === 'PAID' ? 'bg-green-100 text-green-700' :
                                h.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                                'bg-gray-200 text-gray-700'
                              }`}>{h.status}</span>
                              <span className="text-gray-500">{h.billing_type}</span>
                              <strong className="text-gray-900">{fmtBRL(h.amount)}</strong>
                            </div>
                            <div className="text-[10px] text-gray-500 mt-0.5">
                              {fmtDate(h.created_at)}{h.account ? ` · ${h.account.name}` : ''}
                            </div>
                          </div>
                          {h.invoice_url && (
                            <a href={h.invoice_url} target="_blank" rel="noopener noreferrer"
                              className="text-blue-600 hover:underline text-[10px]">
                              Link
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
