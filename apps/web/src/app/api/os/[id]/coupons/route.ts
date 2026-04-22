import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

/**
 * GET /api/os/[id]/coupons
 *
 * Lista cupons ATIVOS (used_at=null) do cliente da OS, + info basica
 * de OS ja usadas (pra relatorio). Usado pela UI pra mostrar botao
 * "Aplicar cupom" quando cliente tem credito disponivel.
 *
 * POST /api/os/[id]/coupons/apply — aplica cupom na OS (outro endpoint)
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true, customer_id: true, discount_amount: true, total_cost: true },
    })
    if (!os) return error('OS nao encontrada', 404)
    if (!os.customer_id) return success({ available: [], used: [] })

    const available = await prisma.coupon.findMany({
      where: {
        company_id: user.companyId,
        customer_id: os.customer_id,
        used_at: null,
      },
      orderBy: { issued_at: 'asc' },
      select: {
        id: true, code: true, source: true,
        discount_type: true, discount_value: true,
        issued_at: true, notes: true,
      },
    })

    const used = await prisma.coupon.findMany({
      where: {
        company_id: user.companyId,
        customer_id: os.customer_id,
        used_at: { not: null },
      },
      orderBy: { used_at: 'desc' },
      take: 10,
      select: {
        id: true, code: true, discount_type: true, discount_value: true,
        used_at: true, used_on_os_id: true,
      },
    })

    return success({ available, used })
  } catch (err) {
    return handleError(err)
  }
}
