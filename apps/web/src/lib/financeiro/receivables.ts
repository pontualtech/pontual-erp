// Lib compartilhada de criacao de accounts_receivable + installments.
//
// Centraliza a logica que estava duplicada em multiplos endpoints (admin
// cadastro, motorista entrega, balcao OS charge, portal payments, contracts,
// etc). Cada endpoint passa seus campos + opcionalmente splits[].
//
// Quando splits[] vem preenchido: cria N receivables agrupados via group_id.
// Sem splits[]: comportamento atual (1 receivable).

import { prisma } from '@pontual/db'
import { resolveDestinationAccount } from './account-resolver'

export interface ReceivableSplit {
  payment_method?: string
  account_id?: string | null
  amount: number // em centavos
  installment_count?: number
}

export interface CreateReceivableCommonArgs {
  companyId: string
  customerId?: string | null
  serviceOrderId?: string | null
  description: string
  notes?: string | null
  dueDate: Date | string
  categoryId?: string | null
  totalAmount: number // em centavos
  status?: string // default 'PENDENTE'
  receivedAmount?: number // pra cobranca presencial paga na hora
  receiptUrl?: string | null
  // 2026-05-20: true quando origem da confirmacao e confiavel (webhook Asaas, OFX match).
  // false (default) pra declaracao manual (motorista, balcao, cadastro admin) — AR vira
  // PAGO mas fica marcado "aguardando conciliacao" ate financeiro bater o extrato.
  reconciled?: boolean
  // Modo unico
  paymentMethod?: string
  accountId?: string | null
  installmentCount?: number
  // 2026-06-13: origem do pagamento (ex: 'portal') — usada pra resolver a conta
  // destino quando accountId nao vem. PIX via portal/asaas cai no ASSAS; PIX
  // presencial cai no Itau. Ver lib/financeiro/account-resolver.
  source?: string | null
  // Modo split — se preenchido, cria N receivables agrupados
  splits?: ReceivableSplit[]
}

// Helper interno que cria UM receivable + suas installments
async function createOneReceivableInternal(args: {
  companyId: string
  customerId: string | null
  serviceOrderId: string | null
  description: string
  notes?: string | null
  dueDate: Date
  categoryId: string | null
  totalAmount: number
  status: string
  receivedAmount: number
  receiptUrl: string | null
  paymentMethod?: string
  accountId?: string | null
  installmentCount: number
  groupId?: string | null
  reconciled: boolean
  feeSettings: { key: string; value: string }[]
}) {
  const { companyId, customerId, serviceOrderId, description, notes, dueDate,
          categoryId, totalAmount, status, receivedAmount, receiptUrl,
          paymentMethod, accountId, installmentCount, groupId, reconciled, feeSettings } = args

  const isCard = !!paymentMethod && /cart[aã]o|credito|crédito|cartao_cred/i.test(paymentMethod)
  let cardFeeTotal = 0
  let netAmount = totalAmount
  let daysToReceive = 0

  if (isCard && installmentCount >= 1) {
    for (const setting of feeSettings) {
      try {
        const config = JSON.parse(setting.value)
        if ((paymentMethod && paymentMethod.includes(config.name)) || feeSettings.length === 1) {
          daysToReceive = config.days_to_receive || 30
          if (installmentCount === 1 && /débito|debito/i.test(paymentMethod) && config.debit_fee_pct != null) {
            cardFeeTotal = Math.round(totalAmount * config.debit_fee_pct / 100)
          } else if (Array.isArray(config.installments)) {
            for (const range of config.installments) {
              if (installmentCount >= range.from && installmentCount <= range.to) {
                cardFeeTotal = Math.round(totalAmount * range.fee_pct / 100)
                break
              }
            }
          }
          netAmount = totalAmount - cardFeeTotal
          break
        }
      } catch { /* skip invalid config */ }
    }
  }

  const receivable = await prisma.accountReceivable.create({
    data: {
      company_id: companyId,
      customer_id: customerId,
      service_order_id: serviceOrderId,
      description,
      notes: notes || undefined,
      total_amount: totalAmount,
      received_amount: receivedAmount,
      due_date: dueDate,
      category_id: categoryId,
      account_id: accountId || null,
      payment_method: paymentMethod,
      installment_count: installmentCount,
      card_fee_total: cardFeeTotal,
      net_amount: netAmount,
      group_id: groupId || null,
      reconciled,
      receipt_url: receiptUrl || undefined,
      status,
    },
  })

  if (installmentCount > 1 && status !== 'PAGO' && status !== 'RECEBIDO') {
    const baseAmount = Math.floor(netAmount / installmentCount)
    const remainder = netAmount - baseAmount * installmentCount
    const installments = []
    const baseDate = new Date(dueDate)
    for (let i = 0; i < installmentCount; i++) {
      const d = new Date(baseDate)
      if (isCard && daysToReceive > 0) {
        if (i === 0) d.setDate(d.getDate() + daysToReceive)
        else d.setDate(d.getDate() + daysToReceive + 30 * i)
      } else {
        d.setMonth(d.getMonth() + i)
      }
      installments.push({
        company_id: companyId,
        parent_type: 'RECEIVABLE',
        parent_id: receivable.id,
        installment_number: i + 1,
        amount: i === 0 ? baseAmount + remainder : baseAmount,
        due_date: d,
        status: 'PENDENTE',
      })
    }
    await prisma.installment.createMany({ data: installments })
  }

  return receivable
}

/**
 * Cria 1 ou N accounts_receivable, dependendo se args.splits eh preenchido.
 *
 * @returns array com 1 receivable (modo unico) ou N receivables (modo split)
 *          + groupId quando aplicavel
 */
export async function createReceivableOrSplit(args: CreateReceivableCommonArgs): Promise<{
  receivables: Awaited<ReturnType<typeof createOneReceivableInternal>>[]
  groupId: string | null
}> {
  const feeSettings = await prisma.setting.findMany({
    where: { company_id: args.companyId, key: { startsWith: 'card_fee.' } },
    select: { key: true, value: true },
  })

  const dueDateObj = args.dueDate instanceof Date ? args.dueDate : new Date(args.dueDate)
  const status = args.status || 'PENDENTE'
  const receivedAmount = args.receivedAmount ?? 0
  // Default: declaracao manual (false). Webhook Asaas / conciliacao OFX passam reconciled=true explicito.
  const reconciled = args.reconciled === true

  // Modo SPLIT
  if (args.splits && args.splits.length > 0) {
    const splitsSum = args.splits.reduce((s, x) => s + x.amount, 0)
    if (splitsSum !== args.totalAmount) {
      throw new Error(`Soma dos splits (${splitsSum}) deve ser igual ao total (${args.totalAmount})`)
    }

    const groupId = crypto.randomUUID()
    const created = []
    for (let i = 0; i < args.splits.length; i++) {
      const sp = args.splits[i]
      // Status individual do split: se status geral eh PAGO, distribuir baseado em amount
      const splitStatus = status === 'PAGO' || status === 'RECEBIDO' ? status : 'PENDENTE'
      const splitReceived = splitStatus === 'PAGO' || splitStatus === 'RECEBIDO' ? sp.amount : 0
      // 2026-06-13: resolve a conta destino quando o split nao a traz (eco audit —
      // 40% das ARs ficavam sem account_id). Conta explicita do split tem prioridade.
      const splitAccountId = sp.account_id || await resolveDestinationAccount(prisma, args.companyId, sp.payment_method, args.source)
      const rec = await createOneReceivableInternal({
        companyId: args.companyId,
        customerId: args.customerId || null,
        serviceOrderId: args.serviceOrderId || null,
        description: args.splits.length > 1 ? `${args.description} [${i + 1}/${args.splits.length}]` : args.description,
        notes: args.notes,
        dueDate: dueDateObj,
        categoryId: args.categoryId || null,
        totalAmount: sp.amount,
        status: splitStatus,
        receivedAmount: splitReceived,
        receiptUrl: args.receiptUrl || null,
        paymentMethod: sp.payment_method,
        accountId: splitAccountId,
        installmentCount: sp.installment_count || 1,
        groupId,
        reconciled,
        feeSettings,
      })
      created.push(rec)
    }
    return { receivables: created, groupId }
  }

  // Modo UNICO (retrocompat)
  // 2026-06-13: resolve a conta destino quando o caller nao a passa (eco audit).
  const unicoAccountId = args.accountId || await resolveDestinationAccount(prisma, args.companyId, args.paymentMethod, args.source)
  const rec = await createOneReceivableInternal({
    companyId: args.companyId,
    customerId: args.customerId || null,
    serviceOrderId: args.serviceOrderId || null,
    description: args.description,
    notes: args.notes,
    dueDate: dueDateObj,
    categoryId: args.categoryId || null,
    totalAmount: args.totalAmount,
    status,
    receivedAmount,
    receiptUrl: args.receiptUrl || null,
    paymentMethod: args.paymentMethod,
    accountId: unicoAccountId,
    installmentCount: args.installmentCount || 1,
    groupId: null,
    reconciled,
    feeSettings,
  })
  return { receivables: [rec], groupId: null }
}
