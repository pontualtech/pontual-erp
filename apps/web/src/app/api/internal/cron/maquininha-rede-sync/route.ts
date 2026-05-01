import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { RedeApiClient } from '@/lib/acquirer/rede-api-client'

/**
 * POST /api/internal/cron/maquininha-rede-sync
 *
 * Cron diario (idealmente disparado as 03:00 BRT) — puxa vendas Rede
 * dos ultimos N dias (default 3) pra cobrir possiveis ajustes/cancelamentos.
 *
 * Auth: X-Internal-Key (env INTERNAL_API_KEY).
 *
 * Body opcional: {
 *   company_ids?: string[]   — quais empresas processar (default: todas com REDE_*)
 *   days?: number            — janela retroativa (default 3)
 * }
 *
 * Resposta: stats agregadas por empresa.
 */
export async function POST(req: NextRequest) {
  try {
    const internalKey = process.env.INTERNAL_API_KEY || ''
    const provided = req.headers.get('x-internal-key') || ''
    if (!internalKey || provided !== internalKey) return error('Unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const days = Math.max(1, Math.min(30, parseInt(body.days || '3')))

    const today = new Date()
    const fromDate = new Date(today)
    fromDate.setDate(fromDate.getDate() - days)
    const fromStr = fromDate.toISOString().split('T')[0]
    const toStr = today.toISOString().split('T')[0]

    // Lista empresas que tem REDE configurado.
    // Por enquanto MVP: usa env globais (PontualTech). Multi-tenant
    // futuro pode usar provider_config por Account.
    // C8 fix (audit): fail-closed se REDE_DEFAULT_COMPANY_ID não setado —
    // evita rotear vendas REDE pra tenant errado em deploys de novo cliente.
    const parentCompanyNumber = process.env.REDE_PARENT_COMPANY_NUMBER || ''
    const companyId = process.env.REDE_DEFAULT_COMPANY_ID

    if (!parentCompanyNumber) {
      return success({ skipped: true, reason: 'REDE_PARENT_COMPANY_NUMBER nao configurado' })
    }
    if (!companyId) {
      return success({ skipped: true, reason: 'REDE_DEFAULT_COMPANY_ID nao configurado — fail-closed (sem fallback hardcoded)' })
    }

    const client = new RedeApiClient()
    if (!client.isConfigured()) {
      return success({ skipped: true, reason: 'REDE_CLIENT_ID/SECRET nao configurado' })
    }

    const fetched = await client.listSales(parentCompanyNumber, fromStr, toStr)
    let inserted = 0, duplicates = 0, errors = 0

    for (const t of fetched) {
      try {
        await prisma.acquirerTransaction.create({
          data: {
            company_id: companyId,
            acquirer: t.acquirer,
            external_id: t.externalId,
            authorization_code: t.authorizationCode,
            card_brand: t.cardBrand,
            card_last_4: t.cardLast4,
            card_masked: t.cardMasked,
            holder_name: t.holderName,
            modality: t.modality,
            installments: t.installments,
            gross_amount: t.grossAmount,
            net_amount: t.netAmount,
            mdr_fee_amount: t.mdrFeeAmount,
            mdr_fee_percent: t.mdrFeePercent,
            anticipation_fee_amount: t.anticipationFeeAmount,
            anticipation_fee_percent: t.anticipationFeePercent,
            total_fee_amount: t.totalFeeAmount,
            transaction_date: t.transactionDate,
            transaction_time: t.transactionTime,
            expected_credit_date: t.expectedCreditDate,
            terminal_code: t.terminalCode,
            status: t.status,
            raw_data: t.rawData,
            imported_by: 'system:cron',
          },
        })
        inserted++
      } catch (e: any) {
        if (e?.code === 'P2002') duplicates++
        else errors++
      }
    }

    return success({
      ok: true,
      period: { from: fromStr, to: toStr },
      company_id: companyId,
      fetched: fetched.length,
      inserted,
      duplicates,
      errors,
    })
  } catch (err) {
    return handleError(err)
  }
}
