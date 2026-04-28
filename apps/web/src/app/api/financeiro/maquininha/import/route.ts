import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { autoDetect, getParser } from '@/lib/acquirer/registry'
import type { AcquirerName, ImportResult } from '@/lib/acquirer/types'

/**
 * POST /api/financeiro/maquininha/import
 *
 * Recebe arquivo CSV/TXT do extrato de adquirente, parseia e grava em
 * acquirer_transactions. Idempotente por (company_id, acquirer, external_id):
 * upload do mesmo arquivo 2x nao duplica.
 *
 * Body: multipart/form-data com `file` (binary). Opcional: `acquirer`
 *       (forca o adapter ao inves de auto-detect).
 *
 * Permission: financeiro.edit
 *
 * Retorna ImportResult com contagens.
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const form = await req.formData().catch(() => null)
    if (!form) return error('upload deve ser multipart/form-data', 400)

    const file = form.get('file')
    if (!(file instanceof File)) return error('campo "file" obrigatorio', 400)
    if (file.size === 0) return error('arquivo vazio', 400)
    if (file.size > 25 * 1024 * 1024) return error('arquivo > 25MB nao suportado', 400)

    const acquirerHint = (form.get('acquirer') as string | null) || undefined
    const text = await file.text()

    const parser = acquirerHint
      ? getParser(acquirerHint as AcquirerName)
      : autoDetect(text)
    if (!parser) {
      return error(
        'formato nao reconhecido. Adquirentes suportadas: rede. Certifique-se que e o "Relatorio de Vendas" da Rede em CSV.',
        422,
      )
    }

    const { transactions: parsed, errors: parseErrors } = parser.parse(text)

    let inserted = 0
    let duplicates = 0
    let skipped = parseErrors.length

    for (const t of parsed) {
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
        // Unique violation = ja existe (mesma external_id) — conta e segue
        if (e?.code === 'P2002') {
          duplicates++
        } else {
          parseErrors.push({ row: -1, error: e?.message || 'insert falhou' })
          skipped++
        }
      }
    }

    const summary: ImportResult = {
      acquirer: parser.acquirer,
      total_rows: parsed.length + parseErrors.length,
      parsed: parsed.length,
      skipped,
      inserted,
      duplicates,
      errors: parseErrors.slice(0, 50),
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'acquirer_import',
      newValue: { acquirer: parser.acquirer, inserted, duplicates, skipped },
    })

    return success(summary)
  } catch (err) {
    return handleError(err)
  }
}
