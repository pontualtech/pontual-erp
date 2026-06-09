import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * GET /api/fiscal/stats — KPIs do mês corrente pro dashboard /fiscal
 *
 * Retorna:
 *  - emitidas: NF-e emitidas com status AUTHORIZED no mês corrente
 *  - recebidas: NF-e recebidas (DFe SEFAZ) cuja data_emissao está no mês corrente
 *  - rejeitadas: NF-e do mês corrente com status REJECTED (alerta operacional)
 *  - faturado: soma do total_amount das AUTHORIZED do mês (centavos)
 *
 * Mês corrente = primeiro até último dia do mês atual em America/Sao_Paulo.
 */
export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Janela mês corrente (servidor — adequado pra agregação ao minuto)
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    const [emitidas, rejeitadas, faturadoAgg, recebidas] = await Promise.all([
      prisma.invoice.count({
        where: {
          company_id: user.companyId,
          invoice_type: 'NFE',
          status: 'AUTHORIZED',
          authorized_at: { gte: start, lt: end },
        },
      }),
      prisma.invoice.count({
        where: {
          company_id: user.companyId,
          invoice_type: 'NFE',
          status: 'REJECTED',
          created_at: { gte: start, lt: end },
        },
      }),
      prisma.invoice.aggregate({
        where: {
          company_id: user.companyId,
          invoice_type: 'NFE',
          status: 'AUTHORIZED',
          authorized_at: { gte: start, lt: end },
        },
        _sum: { total_amount: true },
      }),
      prisma.nfeRecebida.count({
        where: {
          company_id: user.companyId,
          data_emissao: { gte: start, lt: end },
        },
      }),
    ])

    return success({
      emitidas,
      recebidas,
      rejeitadas,
      faturado_centavos: faturadoAgg._sum.total_amount || 0,
      periodo: { inicio: start.toISOString(), fim: end.toISOString() },
    })
  } catch (err) {
    return handleError(err)
  }
}
