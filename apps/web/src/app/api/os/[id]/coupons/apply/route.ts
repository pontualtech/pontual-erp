import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/os/[id]/coupons/apply
 * Body: { coupon_id: string }
 *
 * Aplica o cupom na OS: soma o desconto calculado ao discount_amount
 * atual e marca o cupom como usado (used_at + used_on_os_id).
 * Se cupom for percent: calcula sobre (total_parts + total_services);
 * se for fixed: soma direto em centavos.
 *
 * Transacional. OS em status final (is_final) nao aceita mudanca de
 * desconto.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const couponId = String(body.coupon_id || '')
    if (!couponId) return error('coupon_id obrigatorio', 400)

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: { module_statuses: { select: { is_final: true } } },
    })
    if (!os) return error('OS nao encontrada', 404)
    if ((os as any).module_statuses?.is_final) {
      return error('OS em status final — nao e possivel alterar desconto', 400)
    }
    if (!os.customer_id) return error('OS sem cliente — nao aceita cupom', 400)

    const coupon = await prisma.coupon.findFirst({
      where: {
        id: couponId,
        company_id: user.companyId,
        customer_id: os.customer_id,
        used_at: null,
      },
    })
    if (!coupon) return error('Cupom nao encontrado, ja usado ou de outro cliente', 404)

    const parts = os.total_parts || 0
    const services = os.total_services || 0
    const subtotal = parts + services
    if (subtotal <= 0) return error('OS sem valor (sem itens) — adicione itens antes', 400)

    // Calcula desconto
    let addedDiscountCents = 0
    if (coupon.discount_type === 'percent') {
      addedDiscountCents = Math.floor(subtotal * coupon.discount_value / 100)
    } else {
      addedDiscountCents = coupon.discount_value
    }
    // Limita desconto total a subtotal (nao zera negativo)
    const existingDiscount = os.discount_amount || 0
    const newDiscount = Math.min(subtotal, existingDiscount + addedDiscountCents)
    const actualApplied = newDiscount - existingDiscount

    const newTotal = Math.max(0, subtotal - newDiscount)

    await prisma.$transaction([
      prisma.coupon.update({
        where: { id: coupon.id },
        data: {
          used_at: new Date(),
          used_on_os_id: os.id,
        },
      }),
      prisma.serviceOrder.update({
        where: { id: os.id },
        data: {
          discount_amount: newDiscount,
          total_cost: newTotal,
          updated_at: new Date(),
        },
      }),
    ])

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'apply_coupon',
      entityId: os.id,
      newValue: {
        coupon_id: coupon.id,
        coupon_code: coupon.code,
        discount_cents_applied: actualApplied,
        new_total: newTotal,
      } as any,
    })

    return success({
      coupon_code: coupon.code,
      discount_applied_cents: actualApplied,
      new_discount_amount: newDiscount,
      new_total: newTotal,
    })
  } catch (err) {
    return handleError(err)
  }
}
