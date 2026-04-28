import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { RedeApiClient } from '@/lib/acquirer/rede-api-client'

/**
 * POST /api/financeiro/maquininha/sync-rede
 *
 * Puxa vendas da API Rede no intervalo solicitado e grava em
 * acquirer_transactions (idempotente por external_id+acquirer).
 *
 * Body:
 *  {
 *    from?: 'YYYY-MM-DD' (default: ontem)
 *    to?:   'YYYY-MM-DD' (default: hoje)
 *    parent_company_number?: string (default: env REDE_PARENT_COMPANY_NUMBER)
 *  }
 *
 * Permission: financeiro.edit
 *
 * Resposta: { fetched, inserted, duplicates, errors, period }
 *
 * Se REDE_CLIENT_ID/SECRET nao configurado, retorna 503 com mensagem
 * orientando configurar — nao quebra a app.
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const fromStr: string = body.from || yesterday.toISOString().split('T')[0]
    const toStr: string = body.to || today.toISOString().split('T')[0]
    const parentCompanyNumber: string = body.parent_company_number
      || process.env.REDE_PARENT_COMPANY_NUMBER
      || ''

    if (!parentCompanyNumber) {
      return error('parent_company_number obrigatorio (ou configure REDE_PARENT_COMPANY_NUMBER no env)', 400)
    }

    const client = new RedeApiClient()
    if (!client.isConfigured()) {
      return error(
        'Credenciais Rede nao configuradas. Adicione REDE_CLIENT_ID e REDE_CLIENT_SECRET no env do Coolify (Sandbox por enquanto; Producao apos email pra produtosapi@userede.com.br).',
        503,
      )
    }

    let fetched: any[]
    try {
      fetched = await client.listSales(parentCompanyNumber, fromStr, toStr)
    } catch (err) {
      return error(`Falha ao consultar API Rede: ${err instanceof Error ? err.message : err}`, 502)
    }

    let inserted = 0
    let duplicates = 0
    const errors: Array<{ external_id?: string; error: string }> = []

    for (const t of fetched) {
      try {
        await prisma.acquirerTransaction.create({
          data: {
            company_id: user.companyId,
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
            imported_by: user.id,
          },
        })
        inserted++
      } catch (e: any) {
        if (e?.code === 'P2002') duplicates++
        else errors.push({ external_id: t.externalId, error: e?.message || 'insert failed' })
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'acquirer_sync_rede',
      newValue: { from: fromStr, to: toStr, fetched: fetched.length, inserted, duplicates, errors: errors.length },
    })

    return success({
      acquirer: 'rede',
      period: { from: fromStr, to: toStr },
      parent_company_number: parentCompanyNumber,
      fetched: fetched.length,
      inserted,
      duplicates,
      errors: errors.slice(0, 50),
    })
  } catch (err) {
    return handleError(err)
  }
}
