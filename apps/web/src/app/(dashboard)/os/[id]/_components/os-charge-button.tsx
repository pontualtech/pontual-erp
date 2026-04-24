'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CreditCard, Loader2, X, Copy, ExternalLink, Check, Zap, FileText, Wallet, Mail, MessageSquare, Clock, History } from 'lucide-react'

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
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

type BillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

const BILLING_OPTIONS: { value: BillingType; label: string; icon: typeof Zap; color: string; desc: string }[] = [
  { value: 'PIX', label: 'PIX', icon: Zap, color: 'emerald', desc: 'Pagamento instantâneo' },
  { value: 'BOLETO', label: 'Boleto', icon: FileText, color: 'amber', desc: 'Cliente paga no banco' },
  { value: 'CREDIT_CARD', label: 'Cartão', icon: Wallet, color: 'indigo', desc: 'Crédito em ate 12x' },
]

/**
 * Modal de cobranca — controlavel externamente via props open/onClose.
 * Use esse componente quando quer acionar de outro lugar (ex: menu de
 * 3 pontos na listagem). Pra uso com botao integrado, use o componente
 * default `OsChargeButton`.
 */
export function OsChargeModal({ osId, osNumber, totalCost, open, onClose }: {
  osId: string
  osNumber: number
  totalCost: number
  open: boolean
  onClose: () => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [history, setHistory] = useState<ChargeHistoryItem[]>([])

  // Form state
  const [accountId, setAccountId] = useState<string>('')
  const [billingType, setBillingType] = useState<BillingType>('BOLETO')
  const [dueDays, setDueDays] = useState(7)
  const [installments, setInstallments] = useState(1)
  const [sendWhats, setSendWhats] = useState(true)
  const [sendEmail, setSendEmail] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ invoice_url: string; billing_type: string; amount: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setLoadingAccounts(true)
    fetch('/api/os/charge-accounts')
      .then(r => r.json())
      .then(d => {
        const list: Account[] = d.data || []
        setAccounts(list)
        if (list.length > 0 && !accountId) setAccountId(list[0].id)
      })
      .catch(() => toast.error('Falha ao carregar contas'))
      .finally(() => setLoadingAccounts(false))

    fetch(`/api/os/${osId}/charge`)
      .then(r => r.json())
      .then(d => setHistory(d.data || []))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, osId])

  async function handleSubmit() {
    if (!accountId) return toast.error('Selecione uma conta bancária')
    if (totalCost <= 0) return toast.error('OS sem valor — adicione o orçamento antes')

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
      if (!res.ok) { toast.error(data.error || 'Falha ao criar cobrança'); return }
      const parts: string[] = []
      if (data.sent_whatsapp) parts.push('WhatsApp')
      if (data.sent_email) parts.push('E-mail')
      toast.success(parts.length ? `Cobrança criada e enviada por ${parts.join(' + ')}` : 'Cobrança criada')
      setResult({
        invoice_url: data.payment.invoice_url,
        billing_type: data.payment.billing_type,
        amount: data.payment.amount,
      })
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

  function reset() {
    setResult(null)
    onClose()
  }

  const selectedAccount = accounts.find(a => a.id === accountId)
  const hasValue = totalCost > 0
  const canSubmit = !submitting && hasValue && !!accountId

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/50 p-4 overflow-y-auto"
          onClick={() => !submitting && reset()}>
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}>

            {/* HEADER */}
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-4 flex items-center justify-between">
              <div className="text-white">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100">Cobrança — v4</p>
                <h3 className="text-lg font-bold">OS #{String(osNumber).padStart(4, '0')}</h3>
              </div>
              <button type="button" onClick={reset} aria-label="Fechar"
                className="text-white/80 hover:text-white hover:bg-white/10 rounded-lg p-2">
                <X className="h-5 w-5" />
              </button>
            </div>

            {result ? (
              /* =================== SUCCESS STATE =================== */
              <div className="p-6 space-y-5">
                <div className="flex flex-col items-center text-center py-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                    <Check className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h4 className="text-lg font-bold text-gray-900 mb-1">Cobrança criada</h4>
                  <p className="text-sm text-gray-500">{BILLING_OPTIONS.find(b => b.value === result.billing_type)?.label} — {fmtBRL(result.amount)}</p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Link de pagamento</p>
                  <div className="flex gap-2">
                    <input type="text" readOnly value={result.invoice_url}
                      aria-label="Link de pagamento"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-xs bg-white font-mono text-gray-700"
                      onFocus={e => e.target.select()} />
                    <button type="button" onClick={() => copyLink(result.invoice_url)}
                      className="px-4 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 flex items-center gap-1.5" title="Copiar">
                      <Copy className="h-4 w-4" /> Copiar
                    </button>
                  </div>
                  <a href={result.invoice_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2.5 text-sm font-semibold">
                    <ExternalLink className="h-4 w-4" /> Abrir link em nova aba
                  </a>
                </div>

                <button type="button" onClick={reset}
                  className="w-full rounded-lg bg-gray-100 hover:bg-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700">
                  Fechar
                </button>
              </div>
            ) : (
              /* =================== FORM STATE =================== */
              <div className="p-6 space-y-5">

                {/* VALOR DESTAQUE */}
                <div className="rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 p-4 text-center">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Valor a cobrar</p>
                  <p className={`text-3xl font-bold ${hasValue ? 'text-gray-900' : 'text-gray-400'}`}>
                    {fmtBRL(totalCost)}
                  </p>
                  {!hasValue && (
                    <p className="text-xs text-red-600 mt-1">OS sem valor — adicione o orçamento primeiro</p>
                  )}
                </div>

                {/* CONTA BANCARIA */}
                <div>
                  <label htmlFor="charge-account" className="block text-sm font-semibold text-gray-700 mb-2">
                    1. Qual conta vai receber?
                  </label>
                  {loadingAccounts ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando contas...
                    </div>
                  ) : accounts.length === 0 ? (
                    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      ⚠️ Nenhuma conta bancária configurada.
                      <p className="text-xs text-amber-700 mt-1">Peça ao administrador pra cadastrar em Configurações → Contas Bancárias.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {accounts.map(a => (
                        <button key={a.id} type="button" onClick={() => setAccountId(a.id)}
                          className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                            accountId === a.id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-gray-900">{a.name}</p>
                              {a.bank_name && <p className="text-xs text-gray-500">{a.bank_name}</p>}
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                              {a.provider}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* FORMA DE PAGAMENTO */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">2. Forma de pagamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {BILLING_OPTIONS.map(opt => {
                      const Icon = opt.icon
                      const active = billingType === opt.value
                      return (
                        <button key={opt.value} type="button" onClick={() => setBillingType(opt.value)}
                          className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                            active
                              ? opt.color === 'emerald' ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : opt.color === 'amber' ? 'border-amber-500 bg-amber-50 text-amber-700'
                              : 'border-indigo-500 bg-indigo-50 text-indigo-700'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                          }`}>
                          <Icon className="h-6 w-6" />
                          <span className="text-sm font-bold">{opt.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1.5">{BILLING_OPTIONS.find(b => b.value === billingType)?.desc}</p>
                </div>

                {/* CONDITIONAL: VENCIMENTO BOLETO */}
                {billingType === 'BOLETO' && (
                  <div>
                    <label htmlFor="charge-due" className="block text-sm font-semibold text-gray-700 mb-2">
                      <Clock className="inline h-3.5 w-3.5 mr-1" /> Vencimento do boleto
                    </label>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setDueDays(d => Math.max(1, d - 1))}
                        className="w-11 h-11 rounded-xl border-2 border-gray-300 text-xl font-bold text-gray-700 hover:bg-gray-50 active:scale-95">−</button>
                      <div className="flex-1 text-center">
                        <input id="charge-due" type="number" min={1} max={90} value={dueDays}
                          onChange={e => setDueDays(Math.max(1, Math.min(90, parseInt(e.target.value || '7', 10))))}
                          className="w-full h-11 rounded-xl border-2 border-amber-500 text-center text-xl font-bold bg-amber-50 text-amber-800"
                          aria-label="Dias ate vencimento" />
                      </div>
                      <button type="button" onClick={() => setDueDays(d => Math.min(90, d + 1))}
                        className="w-11 h-11 rounded-xl border-2 border-gray-300 text-xl font-bold text-gray-700 hover:bg-gray-50 active:scale-95">+</button>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1.5 text-center">
                      Cliente terá <strong>{dueDays} dia{dueDays === 1 ? '' : 's'}</strong> pra pagar
                    </p>
                  </div>
                )}

                {/* CONDITIONAL: PARCELAS CARTAO */}
                {billingType === 'CREDIT_CARD' && hasValue && (
                  <div>
                    <label htmlFor="charge-inst" className="block text-sm font-semibold text-gray-700 mb-2">Parcelas</label>
                    <select id="charge-inst" value={installments}
                      onChange={e => setInstallments(parseInt(e.target.value, 10))}
                      className="w-full rounded-xl border-2 border-gray-300 px-4 py-2.5 text-sm font-medium bg-white">
                      {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                        <option key={n} value={n}>
                          {n}x de {fmtBRL(Math.round(totalCost / n))}{n === 1 ? ' — à vista' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* CANAIS */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">3. Enviar para o cliente via</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setSendWhats(s => !s)}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all ${
                        sendWhats ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500'
                      }`}>
                      <MessageSquare className="h-4 w-4" />
                      <span className="text-sm font-semibold">WhatsApp</span>
                      {sendWhats && <Check className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => setSendEmail(s => !s)}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all ${
                        sendEmail ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-500'
                      }`}>
                      <Mail className="h-4 w-4" />
                      <span className="text-sm font-semibold">E-mail</span>
                      {sendEmail && <Check className="h-4 w-4" />}
                    </button>
                  </div>
                  {!sendWhats && !sendEmail && (
                    <p className="text-[11px] text-amber-700 mt-1.5">⚠️ Nenhum canal selecionado — link só ficará disponível na tela da OS</p>
                  )}
                </div>

                {/* HISTORICO COLLAPSIBLE */}
                {history.length > 0 && (
                  <div className="border-t pt-4">
                    <button type="button" onClick={() => setHistoryOpen(o => !o)}
                      className="flex items-center justify-between w-full text-sm font-semibold text-gray-700 hover:text-gray-900">
                      <span className="flex items-center gap-1.5">
                        <History className="h-4 w-4" />
                        Histórico ({history.length})
                      </span>
                      <span className="text-xs text-gray-400">{historyOpen ? 'Ocultar' : 'Ver'}</span>
                    </button>
                    {historyOpen && (
                      <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                        {history.map(h => (
                          <div key={h.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg p-2.5">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                  h.status === 'CONFIRMED' || h.status === 'PAID' ? 'bg-green-100 text-green-700' :
                                  h.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                                  'bg-gray-200 text-gray-700'
                                }`}>{h.status}</span>
                                <span className="text-xs font-semibold">{fmtBRL(h.amount)}</span>
                                <span className="text-[10px] text-gray-500">{h.billing_type}</span>
                              </div>
                              <p className="text-[10px] text-gray-500 mt-0.5">
                                {fmtDateTime(h.created_at)}{h.account ? ` · ${h.account.name}` : ''}
                              </p>
                            </div>
                            {h.invoice_url && (
                              <a href={h.invoice_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1 shrink-0">
                                <ExternalLink className="h-3 w-3" /> abrir
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* CTA */}
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={reset}
                    className="px-4 py-3 rounded-xl border-2 border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Cancelar
                  </button>
                  <button type="button" onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md">
                    {submitting ? <><Loader2 className="h-5 w-5 animate-spin" /> Criando...</> : <><CreditCard className="h-5 w-5" /> Cobrar {fmtBRL(totalCost)}</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Botao + Modal integrados. Use esse componente quando quer o botao verde
 * "Cobrar" direto na tela (ex: cabecalho da OS). Pra trigger customizado
 * (ex: item de menu), importe `OsChargeModal` e controle o open externamente.
 */
export default function OsChargeButton({ osId, osNumber, totalCost }: {
  osId: string
  osNumber: number
  totalCost: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
        title="Enviar link de pagamento ao cliente (PIX, boleto ou cartao)">
        <CreditCard className="h-4 w-4" /> Cobrar
      </button>
      <OsChargeModal osId={osId} osNumber={osNumber} totalCost={totalCost}
        open={open} onClose={() => setOpen(false)} />
    </>
  )
}
