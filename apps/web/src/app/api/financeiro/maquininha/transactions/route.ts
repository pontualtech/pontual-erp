import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/financeiro/maquininha/transactions
 *
 * Lista transacoes importadas com filtros.
 *
 * Query params:
 *   matched: 'yes' | 'no' (default todos)
 *   status: 'APPROVED' | 'CANCELLED' | 'CHARGEBACK'
 *   from, to: YYYY-MM-DD (filtro por transaction_date)
 *   terminal: codigo da maquininha
 *   limit (default 50, max 500), offset
 *
 * Inclui informacao do match (OS / customer) quando vinculado.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const sp = req.nextUrl.searchParams
    const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') || '50')))
    const offset = Math.max(0, parseInt(sp.get('offset') || '0'))

    const where: any = { company_id: user.companyId }
    const matched = sp.get('matched')
    if (matched === 'yes') where.matched_payment_id = { not: null }
    else if (matched === 'no') where.matched_payment_id = null

    const status = sp.get('status')
    if (status) where.status = status

    const terminal = sp.get('terminal')
    if (terminal) where.terminal_code = terminal

    const from = sp.get('from'), to = sp.get('to')
    if (from || to) {
      where.transaction_date = {}
      if (from) where.transaction_date.gte = new Date(from)
      if (to) where.transaction_date.lte = new Date(to)
    }

    // Filtros adicionais (2026-05-15 — busca facilitada conciliacao humana).
    // Valor em centavos: front converte "635,03" pra 63503 antes de mandar.
    const grossAmount = sp.get('gross_amount')
    if (grossAmount) {
      const n = parseInt(grossAmount, 10)
      if (!Number.isNaN(n)) where.gross_amount = n
    }
    const cardLast4 = sp.get('card_last_4')
    if (cardLast4) where.card_last_4 = cardLast4
    const cardBrand = sp.get('card_brand')
    if (cardBrand) where.card_brand = cardBrand
    const modality = sp.get('modality')
    if (modality) where.modality = modality
    const holderName = sp.get('holder_name')
    if (holderName) where.holder_name = { contains: holderName, mode: 'insensitive' }
    const authCode = sp.get('authorization_code')
    if (authCode) where.authorization_code = authCode
    const nsu = sp.get('nsu')
    if (nsu) where.external_id = { contains: nsu }

    const [list, total] = await Promise.all([
      prisma.acquirerTransaction.findMany({
        where,
        orderBy: [{ transaction_date: 'desc' }, { transaction_time: 'desc' }],
        take: limit,
        skip: offset,
        include: {
          payments: {
            select: {
              id: true,
              service_order_id: true,
              customer_id: true,
              service_orders: { select: { os_number: true } },
              customers: { select: { legal_name: true } },
            },
          },
        },
      }),
      prisma.acquirerTransaction.count({ where }),
    ])

    return success({
      total,
      limit,
      offset,
      data: list.map(t => ({
        id: t.id,
        external_id: t.external_id,
        transaction_date: t.transaction_date,
        transaction_time: t.transaction_time,
        gross_amount: t.gross_amount,
        net_amount: t.net_amount,
        mdr_fee_amount: t.mdr_fee_amount,
        mdr_fee_percent: t.mdr_fee_percent,
        anticipation_fee_amount: t.anticipation_fee_amount,
        anticipation_fee_percent: t.anticipation_fee_percent,
        total_fee_amount: t.total_fee_amount,
        modality: t.modality,
        installments: t.installments,
        card_brand: t.card_brand,
        card_last_4: t.card_last_4,
        card_masked: t.card_masked,
        holder_name: t.holder_name,
        authorization_code: t.authorization_code,
        expected_credit_date: t.expected_credit_date,
        terminal_code: t.terminal_code,
        acquirer: t.acquirer,
        status: t.status,
        match: t.matched_payment_id ? {
          payment_id: t.matched_payment_id,
          method: t.match_method,
          os_number: t.payments?.service_orders?.os_number || null,
          customer_name: t.payments?.customers?.legal_name || null,
          matched_at: t.matched_at,
        } : null,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}
