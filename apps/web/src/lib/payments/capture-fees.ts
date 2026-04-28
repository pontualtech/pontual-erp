import { prisma } from '@pontual/db'
import { getPaymentProviderForAccount, getPaymentProvider } from './factory'
import type { PaymentFee } from './types'

/**
 * Apos webhook PAYMENT_RECEIVED dar baixa no AR, captura as taxas
 * cobradas pelo gateway sobre essa cobranca e cria 1 AccountPayable
 * consolidado (1 AP por payment, conforme decisao Karlao opcao B).
 *
 * Provider-agnostic: se o adapter nao implementar getFeesForPayment,
 * funcao retorna sem erro. PontualTech troca de hub frequentemente,
 * entao a logica de mapear fees fica DENTRO de cada adapter.
 *
 * Categoria do AP é baseada no billingType principal da transacao:
 *   PIX     → "Taxa PIX"
 *   BOLETO  → "Taxa Boleto"
 *   CARTAO  → "Taxas de Cartao (Operadora)" (categoria existente)
 *   outros  → "Taxas Pagamento Online"
 *
 * Notificacoes (SMS/email cobradas pelo gateway) entram na descricao
 * discriminadamente — nao geram AP separado (escolha B).
 *
 * Fire-and-forget: erros sao logados mas nao revertidos. Asaas pode
 * retentar webhook se a baixa principal falhar; capture de fees nao
 * precisa ser atomico com baixa.
 */
export async function captureFeesForPayment(payment: {
  id: string
  external_id: string | null
  service_order_id: string | null
  receivable_id: string | null
  company_id: string
  billing_type: string | null
  metadata: any
}): Promise<{ ok: boolean; fees_count: number; ap_id?: string; error?: string }> {
  if (!payment.external_id) return { ok: false, fees_count: 0, error: 'sem external_id' }

  // Resolve provider (multi-account: a conta usada na cobranca pode ser
  // diferente da global se houver multiplas Asaas configuradas)
  const accountId = (payment.metadata as Record<string, string> | null)?.account_id
  const provider = accountId
    ? await getPaymentProviderForAccount(accountId, payment.company_id)
    : getPaymentProvider()
  if (!provider?.getFeesForPayment) {
    return { ok: false, fees_count: 0, error: 'provider sem getFeesForPayment' }
  }

  let fees: PaymentFee[] = []
  try {
    fees = await provider.getFeesForPayment(payment.external_id)
  } catch (err) {
    return { ok: false, fees_count: 0, error: err instanceof Error ? err.message : 'fetch fees falhou' }
  }
  if (fees.length === 0) return { ok: true, fees_count: 0 }

  // Resolver categoria pela transacao principal
  const transactionFee = fees.find(f => f.type === 'TRANSACTION')
  const billingType = transactionFee?.billingType || payment.billing_type || ''
  const categoryName = resolveCategoryName(billingType)
  const category = await prisma.category.findFirst({
    where: { company_id: payment.company_id, module: 'financeiro_despesa', name: categoryName },
    select: { id: true },
  }).catch(() => null)

  // Description discriminada (escolha B) — agrupa por tipo pra ficar legivel
  // mesmo com muitos fees: "PIX 9x R$8.91 + Mensageria 9x R$8.91 = R$17.82"
  const total = fees.reduce((s, f) => s + f.amount, 0)
  const groups = new Map<string, { count: number; total: number }>()
  for (const f of fees) {
    const label = f.type === 'NOTIFICATION'
      ? 'Mensageria'
      : (f.billingType === 'PIX' ? 'PIX'
        : f.billingType === 'BOLETO' ? 'Boleto'
        : f.billingType === 'CREDIT_CARD' ? 'Cartao'
        : 'Taxa')
    const cur = groups.get(label) || { count: 0, total: 0 }
    cur.count++
    cur.total += f.amount
    groups.set(label, cur)
  }
  const detailParts = Array.from(groups.entries()).map(([label, g]) => {
    const v = (g.total / 100).toFixed(2)
    return g.count > 1 ? `${label} ${g.count}x R$${v}` : `${label} R$${v}`
  })
  const description = `Taxas ${payment.external_id}: ${detailParts.join(' + ')} = R$${(total / 100).toFixed(2)}`

  // Pega numero da OS pra descricao mais legivel
  let osNumberSuffix = ''
  if (payment.service_order_id) {
    const so = await prisma.serviceOrder.findUnique({
      where: { id: payment.service_order_id },
      select: { os_number: true },
    }).catch(() => null)
    if (so?.os_number) {
      osNumberSuffix = ` (OS-${String(so.os_number).padStart(4, '0')})`
    }
  }

  const earliest = fees.reduce(
    (min, f) => (f.occurredAt < min ? f.occurredAt : min),
    fees[0].occurredAt,
  )

  const ap = await prisma.accountPayable.create({
    data: {
      company_id: payment.company_id,
      category_id: category?.id || null,
      description: description + osNumberSuffix,
      total_amount: total,
      paid_amount: total, // gateway ja desconta automaticamente do saldo
      due_date: earliest,
      status: 'PAGO',
      payment_method: 'Desconto automatico',
      notes: JSON.stringify({
        source: 'capture-fees',
        provider: provider.name,
        external_id: payment.external_id,
        fees_breakdown: fees.map(f => ({
          type: f.type,
          billingType: f.billingType,
          description: f.description,
          amount: f.amount,
          occurredAt: f.occurredAt.toISOString(),
        })),
      }),
    },
  })

  return { ok: true, fees_count: fees.length, ap_id: ap.id }
}

function resolveCategoryName(billingType: string): string {
  const bt = String(billingType).toUpperCase()
  if (bt === 'PIX') return 'Taxa PIX'
  if (bt === 'BOLETO') return 'Taxa Boleto'
  if (bt.includes('CARTAO') || bt.includes('CARD') || bt.includes('CREDIT')) return 'Taxas de Cartao (Operadora)'
  return 'Taxas Pagamento Online'
}
