import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, paginated, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

// Split = uma forma de pagamento dentro do receivable.
// Quando cliente paga em formas diferentes (ex: 500 PIX + 200 cartao 2x),
// cada split vira 1 receivable independente, todos com mesmo group_id.
const splitSchema = z.object({
  payment_method: z.string().optional(),
  account_id: z.string().optional(),
  amount: z.number().int().positive('Valor do split deve ser positivo'),
  installment_count: z.number().int().min(1).max(120).optional(),
})

const createReceivableSchema = z.object({
  customer_id: z.string().optional(),
  service_order_id: z.string().optional(),
  description: z.string().min(1, 'Descrição é obrigatória'),
  notes: z.string().optional(),
  total_amount: z.number().int().positive('Valor deve ser positivo'),
  due_date: z.string(),
  category_id: z.string().optional(),
  account_id: z.string().optional(), // Sprint UX-23: pré-vincular conta bancária destino
  payment_method: z.string().optional(),
  installment_count: z.number().int().min(1).max(120).optional(),
  // Split payment 2026-05-19: se splits[] vier preenchido, criamos N receivables
  // (um por split) agrupados via group_id. Caso contrario, comportamento atual
  // (1 receivable com payment_method/account_id/installment_count flat).
  splits: z.array(splitSchema).optional(),
})

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    // HOTFIX 2026-05-03: aceita customer_id (snake_case do frontend) E customerId
    // (camelCase legacy). Antes só camelCase → frontend passava customer_id que era
    // ignorado → query retornava TODAS as contas da empresa em vez do cliente
    // específico (vazamento de dados ao abrir cadastro de qualquer cliente).
    const customerId = searchParams.get('customer_id') || searchParams.get('customerId')
    const search = searchParams.get('search')
    const categoryId = searchParams.get('categoryId')
    const paymentMethod = searchParams.get('paymentMethod')
    const valueMin = searchParams.get('valueMin')
    const valueMax = searchParams.get('valueMax')
    const dateType = searchParams.get('dateType') || 'vencimento'
    const bankAccountId = searchParams.get('bankAccountId')
    // 2026-05-14: filtro por status da cobranca Asaas (charge_status).
    // Valor especial 'NONE' filtra ARs sem cobranca gerada (charge_status null).
    const chargeStatus = searchParams.get('chargeStatus')

    const where: any = { company_id: user.companyId, deleted_at: null }

    if (chargeStatus) {
      if (chargeStatus === 'NONE') {
        where.charge_status = null
      } else {
        where.charge_status = chargeStatus
      }
    }

    if (status) {
      if (status === 'VENCIDO') {
        where.status = 'PENDENTE'
        where.due_date = { lt: new Date() }
      } else {
        where.status = status
      }
    }

    if (customerId) where.customer_id = customerId
    if (categoryId) where.category_id = categoryId
    if (paymentMethod) where.payment_method = paymentMethod
    // Sprint UX-23: schema usa `account_id` (banco que recebera/recebeu),
    // NAO `bank_account_id` (coluna inexistente — Prisma rejeita).
    if (bankAccountId) where.account_id = bankAccountId

    if (valueMin || valueMax) {
      where.total_amount = {}
      if (valueMin) where.total_amount.gte = Number(valueMin)
      if (valueMax) where.total_amount.lte = Number(valueMax)
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    // Determine which date field to filter based on dateType
    // Audit fix 2026-05-14 #4: status=VENCIDO ja setou where.status=PENDENTE
    // e where.due_date={lt:now}. dateType=pagamento sobrescrevia pra
    // status=RECEBIDO criando query contraditoria. Agora: se status=VENCIDO,
    // dateType=pagamento eh ignorado (incompativel logicamente).
    const skipDateTypeForStatus = status === 'VENCIDO' && dateType === 'pagamento'
    if ((startDate || endDate) && !skipDateTypeForStatus) {
      if (dateType === 'emissao') {
        if (!where.created_at) where.created_at = {}
        if (startDate) where.created_at.gte = new Date(startDate)
        if (endDate) where.created_at.lte = new Date(endDate)
      } else if (dateType === 'pagamento') {
        where.status = 'RECEBIDO'
        if (!where.updated_at) where.updated_at = {}
        if (startDate) where.updated_at.gte = new Date(startDate)
        if (endDate) where.updated_at.lte = new Date(endDate)
      } else {
        // default: vencimento (due_date)
        if (!where.due_date) where.due_date = {}
        if (startDate) where.due_date.gte = new Date(startDate)
        if (endDate) where.due_date.lte = new Date(endDate)
      }
    }

    const [receivables, total, filteredAgg] = await Promise.all([
      prisma.accountReceivable.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { due_date: 'asc' },
        include: {
          customers: { select: { id: true, legal_name: true } },
          categories: { select: { id: true, name: true } },
        },
      }),
      prisma.accountReceivable.count({ where }),
      prisma.accountReceivable.aggregate({
        where,
        _sum: { total_amount: true },
      }),
    ])

    // Compute summary for top cards
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // M-006: refactor $queryRawUnsafe → $queryRaw tagged template literal.
    // Single raw query for all 4 summaries (1 scan instead of 4).
    type ReceivableSummaryRow = {
      aberto_sum: bigint | number; aberto_count: bigint
      vencidas_sum: bigint | number; vencidas_count: bigint
      hoje_sum: bigint | number; hoje_count: bigint
      recebidas_sum: bigint | number; recebidas_count: bigint
    }
    const summaryRows = await prisma.$queryRaw<ReceivableSummaryRow[]>`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' THEN total_amount ELSE 0 END), 0) as aberto_sum,
        COUNT(CASE WHEN status = 'PENDENTE' THEN 1 END) as aberto_count,
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' AND due_date < ${today} THEN total_amount ELSE 0 END), 0) as vencidas_sum,
        COUNT(CASE WHEN status = 'PENDENTE' AND due_date < ${today} THEN 1 END) as vencidas_count,
        COALESCE(SUM(CASE WHEN status = 'PENDENTE' AND due_date >= ${today} AND due_date < ${tomorrow} THEN total_amount ELSE 0 END), 0) as hoje_sum,
        COUNT(CASE WHEN status = 'PENDENTE' AND due_date >= ${today} AND due_date < ${tomorrow} THEN 1 END) as hoje_count,
        COALESCE(SUM(CASE WHEN status = 'RECEBIDO' AND updated_at >= ${startOfMonth} AND updated_at <= ${endOfMonth} THEN total_amount ELSE 0 END), 0) as recebidas_sum,
        COUNT(CASE WHEN status = 'RECEBIDO' AND updated_at >= ${startOfMonth} AND updated_at <= ${endOfMonth} THEN 1 END) as recebidas_count
      FROM accounts_receivable
      WHERE company_id = ${user.companyId} AND deleted_at IS NULL
    `

    const s: Partial<ReceivableSummaryRow> = summaryRows[0] ?? {}
    const totalAberto = { _sum: { total_amount: Number(s.aberto_sum) || 0 }, _count: Number(s.aberto_count) || 0 }
    const totalVencidas = { _sum: { total_amount: Number(s.vencidas_sum) || 0 }, _count: Number(s.vencidas_count) || 0 }
    const vencendoHoje = { _sum: { total_amount: Number(s.hoje_sum) || 0 }, _count: Number(s.hoje_count) || 0 }
    const recebidasMes = { _sum: { total_amount: Number(s.recebidas_sum) || 0 }, _count: Number(s.recebidas_count) || 0 }

    return NextResponse.json({
      data: receivables,
      total,
      filteredSum: filteredAgg._sum.total_amount || 0,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        total_aberto: totalAberto._sum.total_amount || 0,
        total_aberto_count: totalAberto._count || 0,
        total_vencidas: totalVencidas._sum.total_amount || 0,
        total_vencidas_count: totalVencidas._count || 0,
        vencendo_hoje: vencendoHoje._sum.total_amount || 0,
        vencendo_hoje_count: vencendoHoje._count || 0,
        recebidas_mes: recebidasMes._sum.total_amount || 0,
        recebidas_mes_count: recebidasMes._count || 0,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * Cria UM accounts_receivable + suas installments. Encapsula calculo de
 * card_fee, net_amount e geracao de installments. Usado pelo handler POST
 * tanto no modo unico (sem splits[]) quanto no modo split (iterado por split).
 *
 * Side note: feeSettings e passado pra evitar refetch quando ha varios splits
 * de cartao no mesmo POST (1 query so).
 */
async function createOneReceivable(args: {
  companyId: string
  customerId: string | null
  serviceOrderId: string | null
  description: string
  notes?: string
  dueDate: string
  categoryId: string | null
  totalAmount: number
  paymentMethod?: string
  accountId?: string | null
  installmentCount: number
  groupId?: string | null
  feeSettings: { key: string; value: string }[]
}) {
  const { companyId, customerId, serviceOrderId, description, notes, dueDate,
          categoryId, totalAmount, paymentMethod, accountId, installmentCount,
          groupId, feeSettings } = args

  const isCard = !!paymentMethod && (paymentMethod.includes('Cartão') || paymentMethod.includes('Credito') || paymentMethod.includes('Crédito'))
  let cardFeeTotal = 0
  let netAmount = totalAmount
  let daysToReceive = 0

  if (isCard && installmentCount >= 1) {
    for (const setting of feeSettings) {
      try {
        const config = JSON.parse(setting.value)
        if ((paymentMethod && paymentMethod.includes(config.name)) || feeSettings.length === 1) {
          daysToReceive = config.days_to_receive || 30
          if (installmentCount === 1 && paymentMethod?.includes('Débito') && config.debit_fee_pct != null) {
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
      notes,
      total_amount: totalAmount,
      due_date: new Date(dueDate),
      category_id: categoryId,
      account_id: accountId || null,
      payment_method: paymentMethod,
      installment_count: installmentCount,
      card_fee_total: cardFeeTotal,
      net_amount: netAmount,
      group_id: groupId || null,
      status: 'PENDENTE',
    },
  })

  if (installmentCount > 1) {
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

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = createReceivableSchema.parse(body)

    // Refetch card_fee settings 1x (compartilhado entre todos splits de cartao)
    const feeSettings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { startsWith: 'card_fee.' } },
      select: { key: true, value: true },
    })

    const hasSplits = Array.isArray(data.splits) && data.splits.length > 0

    if (hasSplits) {
      // Modo SPLIT: cria N receivables agrupados via group_id
      const splits = data.splits!
      const splitsSum = splits.reduce((s, x) => s + x.amount, 0)
      if (splitsSum !== data.total_amount) {
        return error(`Soma dos splits (${splitsSum}) deve ser igual ao total (${data.total_amount})`, 400)
      }

      const groupId = crypto.randomUUID()
      const created = []
      for (let i = 0; i < splits.length; i++) {
        const sp = splits[i]
        const rec = await createOneReceivable({
          companyId: user.companyId,
          customerId: data.customer_id || null,
          serviceOrderId: data.service_order_id || null,
          description: splits.length > 1 ? `${data.description} [${i + 1}/${splits.length}]` : data.description,
          notes: data.notes,
          dueDate: data.due_date,
          categoryId: data.category_id || null,
          totalAmount: sp.amount,
          paymentMethod: sp.payment_method,
          accountId: sp.account_id || null,
          installmentCount: sp.installment_count || 1,
          groupId,
          feeSettings,
        })
        created.push(rec)
      }

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'financeiro',
        action: 'receivable.create_split',
        entityId: groupId,
        newValue: { description: data.description, total_amount: data.total_amount, splits_count: splits.length, group_id: groupId },
      })

      return success({ group_id: groupId, receivables: created }, 201)
    }

    // Modo UNICO (retrocompat): comportamento atual
    const receivable = await createOneReceivable({
      companyId: user.companyId,
      customerId: data.customer_id || null,
      serviceOrderId: data.service_order_id || null,
      description: data.description,
      notes: data.notes,
      dueDate: data.due_date,
      categoryId: data.category_id || null,
      totalAmount: data.total_amount,
      paymentMethod: data.payment_method,
      accountId: data.account_id || null,
      installmentCount: data.installment_count || 1,
      groupId: null,
      feeSettings,
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.create',
      entityId: receivable.id,
      newValue: { description: receivable.description, total_amount: receivable.total_amount, installments: data.installment_count || 1 },
    })

    return success(receivable, 201)
  } catch (err) {
    return handleError(err)
  }
}
